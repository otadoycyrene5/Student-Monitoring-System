'use strict';

const {fork}=require('node:child_process'),{EventEmitter}=require('node:events'),crypto=require('node:crypto'),assert=require('node:assert/strict');
require('dotenv').config({path:require('node:path').join(__dirname,'../.env'),quiet:true});
const encode=value=>Buffer.isBuffer(value)?{__testBuffer:value.toString('hex')}:value instanceof Date?{__testDate:value.toISOString()}:Array.isArray(value)?value.map(encode):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v)])):value;
const decode=value=>value?.__testBuffer?Buffer.from(value.__testBuffer,'hex'):value?.__testDate?new Date(value.__testDate):Array.isArray(value)?value.map(decode):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,decode(v)])):value;
if(process.env.CLASSENCE_RECOVERY_CHILD==='1'){
 const pending=new Map();let seq=0;
 process.on('message',m=>{const entry=pending.get(m.id);if(!entry)return;pending.delete(m.id);m.error?entry.reject(Object.assign(new Error('Test SQL failed'),m.error)):entry.resolve([decode(m.rows),null]);});
 const query=(...args)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});process.send({type:'sql',id,args:encode(args)});});
 const testPool={execute:query,query,getConnection:async()=>Object.assign(new EventEmitter(),{execute:query,query,beginTransaction:()=>query('SAVEPOINT process_recovery'),commit:()=>query('RELEASE SAVEPOINT process_recovery'),rollback:()=>query('ROLLBACK TO SAVEPOINT process_recovery'),release(){}})};
 (async()=>{const instance=require('../src/index').setup({pool:testPool}),server=require('node:http').createServer(instance.app);const realtime=await require('../src/realtime').attachRealtime(server,testPool,process.env.CLIENT_ORIGIN.split(','),{lockName:process.env.CLASSENCE_RECOVERY_LOCK,reconcileClassIds:[process.env.CLASSENCE_RECOVERY_CLASS]});instance.app.locals.realtime=realtime;server.listen(0,'127.0.0.1',()=>process.send({type:'ready',port:server.address().port}));})().catch(e=>{console.error('Child startup failed: '+e.code+' '+e.message);process.exit(1);});
}else{
 (async()=>{
  const pool=require('../src/config/database'),db=await pool.getConnection(),{createAuthService}=require('../src/services/authService'),{createLiveService}=require('../src/services/liveService'),{createMeetMonitoringService}=require('../src/services/meetMonitoringService');let child,sqlTail=Promise.resolve();const before={},tables=['users','faculty_profiles','student_profiles','auth_sessions','session_families','refresh_credentials','session_security_events','classes','enrollments','sessions','attendance','session_participants','session_connection_intervals','activity_logs','meet_monitoring','attendance_audit'];
  const testPool={execute:(...a)=>db.execute(...a),query:(...a)=>db.query(...a),getConnection:async()=>({execute:(...a)=>db.execute(...a),query:(...a)=>db.query(...a),beginTransaction:()=>db.query('SAVEPOINT process_parent'),commit:()=>db.query('RELEASE SAVEPOINT process_parent'),rollback:()=>db.query('ROLLBACK TO SAVEPOINT process_parent'),release(){}})};
  async function launch(classId,lockName){
   child=fork(__filename,[],{env:{...process.env,CLASSENCE_RECOVERY_CHILD:'1',CLASSENCE_RECOVERY_CLASS:classId,CLASSENCE_RECOVERY_LOCK:lockName},silent:true,windowsHide:true});child.stdout.resume();child.stderr.on('data',d=>process.stderr.write(d));
   return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Child backend startup timed out')),15000);child.once('exit',()=>{clearTimeout(timer);reject(new Error('Child backend exited before ready'));});child.on('message',m=>{if(m.type==='ready'){clearTimeout(timer);resolve('http://127.0.0.1:'+m.port);}else if(m.type==='sql'){const source=child;sqlTail=sqlTail.then(async()=>{try{const args=decode(m.args);const [rows]=await db.query(...args);if(source.connected)source.send({id:m.id,rows:encode(rows)});}catch(e){if(source.connected)source.send({id:m.id,error:{code:e.code}});}});}});});
  }
  async function terminate(){if(!child)return;const current=child;if(current.exitCode!==null||current.signalCode!==null){child=null;await sqlTail;return;}await new Promise(resolve=>{current.once('exit',resolve);current.kill('SIGKILL');});child=null;await sqlTail;}
  try{
   for(const t of tables){const [[r]]=await db.query('SELECT COUNT(*) n FROM '+t);before[t]=r.n;}await db.beginTransaction();
   process.env.CLIENT_ORIGIN='http://127.0.0.1:5500';const uid=crypto.randomUUID(),password='ProcessRecovery123!',auth=createAuthService(testPool,900),live=createLiveService(testPool),monitor=createMeetMonitoringService(testPool),identities=[],credentials=[];
   for(const [i,role]of ['faculty','student'].entries()){const u=await auth.register(role,{email:'process-'+i+'-'+uid+'@example.edu',password,fullName:'Process fixture '+i,facultyId:'F-'+uid,department:'Computing',academicPosition:'Professor',studentId:'S-'+uid,program:'BSIT',yearLevel:3,section:'BSIT 3-1'});const c=await auth.login({email:u.email,password},true);credentials.push(c);identities.push(await auth.authenticate(c.accessToken));}
   const c=await live.create(identities[0],{name:'Process recovery',section:'BSIT 3-1',meet:'https://meet.google.com/abc-defg-hij'});await live.enroll(identities[1],{code:c.code});const s=await live.start(identities[0],c.classId);await live.join(identities[1],s.sessionId);const grant=await monitor.start(identities[1],{sessionId:s.sessionId,consent:true});
   const lockName='process_'+uid;let base=await launch(c.classId,lockName);
   const request=async(path,body)=>{const r=await fetch(base+'/api/auth/'+path,{signal:AbortSignal.timeout(10000),method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer '+credentials[1].accessToken},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,...await r.json()};};
   assert.equal((await request('student/me')).status,200);const value={sessionId:s.sessionId,grantId:grant.grantId,eventId:crypto.randomUUID(),sequence:1,tabState:'MEET_TAB_SELECTED',eventType:'RECONCILED',observedAt:new Date().toISOString()};assert.equal((await request('monitoring/event',value)).status,200);
   const originalPid=child.pid;await terminate();await assert.rejects(fetch(base+'/api/health'));base=await launch(c.classId,lockName);assert.notEqual(child.pid,originalPid);
   assert.equal((await request('student/me')).data.user.email,identities[1].email||credentials[1].user.email);assert.equal((await request('monitoring/state?sessionId='+s.sessionId)).data.grantId,grant.grantId);
   const r=await request('monitoring/event',value);assert.equal(r.status,200);assert.equal(r.data.duplicate,true);
   await terminate();await db.execute('SELECT RELEASE_LOCK(?)',[lockName]);await db.rollback();for(const t of tables){const [[r]]=await db.query('SELECT COUNT(*) n FROM '+t);assert.equal(r.n,before[t],t);}
   console.log('PASS RECOVERY PROCESS: actual backend child killed and restarted with different PID; same account/grant and duplicate cursor survive; real MySQL is accessed through test-only IPC inside parent rollback; original records preserved');
  }finally{await terminate();await db.rollback();db.release();await pool.end();}
 })().catch(e=>{console.error(e.stack);process.exitCode=1;});
}
