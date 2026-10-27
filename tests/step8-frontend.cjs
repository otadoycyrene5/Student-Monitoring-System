'use strict';

require('dotenv').config({path:require('node:path').join(__dirname,'../.env'),quiet:true});
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const pool=require('../src/config/database'),{setup}=require('../src/index'),{attachRealtime}=require('../src/realtime'),{createAuthService}=require('../src/services/authService');
(async()=>{
 const root=path.resolve(__dirname,'../../frontend'),results=[];
 const files=process.argv.length>2?process.argv.slice(2):['motion.cjs','faculty-background.cjs','oct-restoration.cjs','dependency-isolation.cjs','registration-options.cjs','teacher-ui-audit.cjs','faculty-overview.cjs','faculty-registration.cjs','student-interface.cjs','student-package.cjs','student-improvements.cjs'];
 try{for(const file of files){
  assert(/^[a-z-]+\.cjs$/.test(file));
  const db=await pool.getConnection(),before={},tables=['users','faculty_profiles','student_profiles','auth_sessions','classes','enrollments','sessions','attendance','session_participants','session_connection_intervals','activity_logs','meet_monitoring'];let preview,server,realtime;
  try{
   for(const table of tables){const [[r]]=await db.query('SELECT COUNT(*) n FROM '+table);before[table]=r.n;}await db.beginTransaction();
   const testPool={execute:(...a)=>db.execute(...a),query:(...a)=>db.query(...a),getConnection:async()=>({execute:(...a)=>db.execute(...a),query:(...a)=>db.query(...a),beginTransaction:()=>db.query('SAVEPOINT frontend_work'),commit:()=>db.query('RELEASE SAVEPOINT frontend_work'),rollback:()=>db.query('ROLLBACK TO SAVEPOINT frontend_work'),release(){}})};
   const uid=crypto.randomUUID(),password=crypto.randomBytes(16).toString('base64url')+'!A1',origin='http://127.0.0.1:8000',extension='chrome-extension://jefdcdmlgafknafmpdondeglcbimdnki';
   process.env.CLIENT_ORIGIN=origin+','+extension;process.env.AUTH_REGISTER_LIMIT='100';process.env.AUTH_LOGIN_LIMIT='100';
   const instance=setup({pool:testPool});server=http.createServer(instance.app);
   realtime=await attachRealtime(server,testPool,[origin,extension],{lockName:'frontend_'+uid,reconcileClassIds:['18446744073709551615']});instance.app.locals.realtime=realtime;
   if(process.env.CLASSENCE_TEST_LEGACY_SUMMARY==='1'){const snapshot=realtime.live.snapshot;realtime.live.snapshot=async(...args)=>{const data=await snapshot(...args);delete data.summary;return data;};}
   await new Promise(r=>server.listen(0,'127.0.0.1',r));const api='http://127.0.0.1:'+server.address().port;
   const auth=createAuthService(testPool,900),accounts={};
   for(const role of ['faculty','student']){const email='stabilization-'+role+'-'+uid+'@example.edu';const user=await auth.register(role,{email,password,fullName:role==='faculty'?'Prof. Stabilization Faculty':'Stabilization Student',facultyId:'F-'+uid,department:'Computing',academicPosition:'Instructor',studentId:'S-'+uid,program:'BSIT',yearLevel:3,section:'BSIT 3-1'});accounts[role]={...user,password};}
   preview=http.createServer((req,res)=>{res.setHeader('Content-Security-Policy',"connect-src "+api+' '+api.replace('http:','ws:')+"; worker-src 'none'");const pathname=new URL(req.url,origin).pathname,filePath=path.resolve(root,'.'+(pathname.endsWith('/')?pathname+'index.html':pathname));if(!filePath.startsWith(root+path.sep)){res.writeHead(403);return res.end();}try{let data=fs.readFileSync(filePath);if(filePath.endsWith('index.html'))data=data.toString().replace('content="http://127.0.0.1:3000"','content="'+api+'"');res.setHeader('Content-Type',filePath.endsWith('.js')?'text/javascript':filePath.endsWith('.css')?'text/css':filePath.endsWith('.html')?'text/html':'image/jpeg');res.end(data);}catch{res.writeHead(404);res.end();}});
   await new Promise((resolve,reject)=>{preview.once('error',reject);preview.listen(8000,'127.0.0.1',resolve);});
   const start=Date.now(),child=spawn(process.execPath,[path.join(root,'tests',file)],{windowsHide:true,env:{...process.env,CLASSENCE_BROWSER_FIXTURE:JSON.stringify({api,origin,...accounts})},stdio:['ignore','pipe','pipe']});let output='',timedOut=false;
   child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);const timeout=setTimeout(()=>{timedOut=true;child.kill();},150000);
   const exitCode=await new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});clearTimeout(timeout);
   const [hashes]=await db.query("SELECT password_hash FROM users WHERE email LIKE ?",['%'+uid+'%']);assert(hashes.length>=2);assert(hashes.every(row=>row.password_hash.startsWith('$argon2id$')&&!row.password_hash.includes(password)));
   await realtime.close();realtime=null;await db.rollback();for(const table of tables){const [[r]]=await db.query('SELECT COUNT(*) n FROM '+table);assert.equal(r.n,before[table],table+' fixture cleanup');}
   const result={runId:process.env.CLASSENCE_STEP8_RUN_ID||'standalone',command:'node frontend/tests/'+file,exitCode,timedOut,seconds:(Date.now()-start)/1000,output,cleanup:'PASS',passwordStorage:'Argon2id verified'};results.push(result);console.log(JSON.stringify(result));fs.writeFileSync(path.join(__dirname,'step8-frontend-results.json'),JSON.stringify(results,null,2)+'\n');
  }finally{if(realtime)await realtime.close();if(server?.listening)await new Promise(r=>server.close(r));if(preview)await new Promise(r=>{preview.close(r);preview.closeAllConnections();});await db.rollback();db.release();}
 }}finally{await pool.end();}
 process.exitCode=results.some(r=>r.exitCode!==0||r.timedOut)?1:0;
})().catch(error=>{console.error(error.code||error.message);process.exitCode=1;});
