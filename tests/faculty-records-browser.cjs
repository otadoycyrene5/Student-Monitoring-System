'use strict';
require('dotenv').config({path:require('node:path').join(__dirname,'../.env'),quiet:true});
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const pool=require('../src/config/database'),{setup}=require('../src/index'),{attachRealtime}=require('../src/realtime'),{createAuthService}=require('../src/services/authService'),{createLiveService}=require('../src/services/liveService'),chromePipe=require('./chrome-pipe.cjs');
(async()=>{
 const db=await pool.getConnection(),before={},tables=['users','faculty_profiles','student_profiles','auth_sessions','classes','enrollments','sessions','attendance','session_participants','session_connection_intervals','activity_logs','meet_monitoring','attendance_audit'];let server,realtime,preview,chrome;let cases=0;
 const check=async(name,work)=>{await work();cases++;console.log('PASS STEP9 CHROME: '+name);};
 try{
  for(const t of tables){const [[r]]=await db.query('SELECT COUNT(*) n FROM '+t);before[t]=r.n;}await db.beginTransaction();
  const testPool={execute:(...a)=>db.execute(...a),query:(...a)=>db.query(...a),getConnection:async()=>({execute:(...a)=>db.execute(...a),query:(...a)=>db.query(...a),beginTransaction:()=>db.query('SAVEPOINT records_browser'),commit:()=>db.query('RELEASE SAVEPOINT records_browser'),rollback:()=>db.query('ROLLBACK TO SAVEPOINT records_browser'),release(){}})};
  const uid=crypto.randomUUID(),password='RecordsBrowser123!',users=[],auth=createAuthService(testPool,900),live=createLiveService(testPool);
  for(let i=0;i<5;i++)users.push(await auth.register(i===0?'faculty':'student',{email:'records-browser-'+i+'-'+uid+'@example.edu',password,fullName:i===0?'Prof. Records Browser':'Roster Student '+i,facultyId:'F-'+uid,department:'Computing',academicPosition:'Professor',studentId:'S-'+i+'-'+uid,program:'BSIT',yearLevel:3,section:'BSIT 3-1'}));
  const root=path.resolve(__dirname,'../../frontend');let base;
  preview=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+(pathname.endsWith('/')?pathname+'index.html':pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}try{let content=fs.readFileSync(file);if(file.endsWith('index.html'))content=content.toString().replace('content="http://127.0.0.1:3000"','content="'+base+'"');res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'image/jpeg');res.end(content);}catch{res.writeHead(404);res.end();}});
  await new Promise(r=>preview.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+preview.address().port;process.env.CLIENT_ORIGIN=origin;
  const instance=setup({pool:testPool});server=http.createServer(instance.app);realtime=await attachRealtime(server,testPool,[origin],{lockName:'records_browser_'+uid,reconcileClassIds:['18446744073709551615']});instance.app.locals.realtime=realtime;await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
  chrome=await chromePipe();const page=await chrome.open(origin+'/teacher/',base);
  const login=async()=>{await page.input('#email',users[0].email);await page.input('#password',password);await page.evaluate('document.querySelector("[data-form=login]").requestSubmit()');await page.wait('!!FacultyAPI.current && !!window.ClassenceRealtime?.data');};
  await login();await page.evaluate('localStorage.setItem("classwatch-demo-v2","original records preserved")');
  let realClass,active,identity;
  const open=async action=>{await page.evaluate('FacultyRecords.open('+JSON.stringify(action)+','+JSON.stringify(String(realClass.id))+')');await page.wait(action==='edit'?'!!document.querySelector("#records-name")':'!!document.querySelector("[data-records-form=attendance]")');};
  const close=async()=>{const attendance=await page.evaluate('!!document.querySelector("[data-attendance-page]")');await page.click('[data-records-close]');if(attendance){await page.wait('!document.querySelector("[data-attendance-page]")');await page.evaluate("navigate('monitor')");}else await page.wait('!document.querySelector("#faculty-records-dialog").open');};
  const submit=async type=>{await page.evaluate('document.querySelector("[data-records-form='+type+']").requestSubmit()');};
  const saved=()=>page.wait('document.querySelector("[data-records-feedback]")?.textContent==="Attendance saved"');
  await check('01 real UI create, enrollment preservation and MySQL edit',async()=>{
   await page.evaluate("navigate('create')");
   for(const [key,value]of Object.entries({name:'Browser Records',section:'BSIT 3-1',meet:'https://meet.google.com/abc-defg-hij'}))await page.input('#'+key,value);
   await page.evaluate('document.querySelector("[data-form=class]").requestSubmit()');await page.wait('!!document.querySelector(".class-title-row")');
   const [[row]]=await db.execute('SELECT * FROM classes WHERE faculty_user_id=?',[users[0].id]);realClass=row;const loginToken=await auth.login({email:users[0].email,password});identity=await auth.authenticate(loginToken.accessToken);
   for(let i=1;i<5;i++){const token=await auth.login({email:users[i].email,password});await live.enroll(await auth.authenticate(token.accessToken),{code:row.class_code});}
   if(process.env.CLASSENCE_RENEWAL_TEST==='1')await require('./renewal-browser-hooks.cjs').faculty({chrome,page,db,origin,base,user:users[0]});
   await open('edit');assert.equal(await page.evaluate('document.querySelector("#records-name").value'),'Browser Records');await page.input('#records-name','Edited MySQL Class');await page.input('#records-section','BSIT 3-2');await page.input('#records-meet','https://meet.google.com/xyz-abcd-efg');await submit('class');await page.wait('!document.querySelector("#faculty-records-dialog").open && db.classes[0]?.name==="Edited MySQL Class"');
   const [[updated]]=await db.execute('SELECT class_name,class_code,meet_link FROM classes WHERE id=?',[row.id]);assert.equal(updated.class_name,'Edited MySQL Class');assert.equal(updated.class_code,row.class_code);assert.equal(updated.meet_link,'https://meet.google.com/xyz-abcd-efg');
  });
  await check('02 class edit survives page refresh and actual logout/login',async()=>{
   await page.command('Page.reload');await page.wait('typeof db!=="undefined" && db.classes[0]?.name==="Edited MySQL Class"');await open('edit');assert.equal(await page.evaluate('document.querySelector("#records-section").value'),'BSIT 3-2');await close();
   await page.click('[data-action=logout]');await page.wait('!!document.querySelector("[data-form=login]")');await login();await open('edit');assert.equal(await page.evaluate('document.querySelector("#records-meet").value'),'https://meet.google.com/xyz-abcd-efg');await close();
  });
  await check('03 live roster displays automatic Present and pending badges without ordinary manual controls',async()=>{
   await page.evaluate("navigate('details',"+JSON.stringify(String(realClass.id))+")");await page.click('[data-action=start]');await page.wait('!!document.querySelector("[data-rt=end]")');const [[s]]=await db.execute("SELECT id FROM sessions WHERE class_id=? AND status='Live'",[realClass.id]);active=String(s.id);
   const token=await auth.login({email:users[1].email,password});await live.join(await auth.authenticate(token.accessToken),active);
   if(process.env.CLASSENCE_RENEWAL_TEST==='1')await db.execute('UPDATE auth_sessions SET expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE user_id=? AND revoked_at IS NULL',[users[0].id]);
   await open('attendance');assert.equal(await page.evaluate('document.querySelectorAll("[data-attendance-status]").length'),4);
   assert.equal(await page.evaluate('!!document.querySelector("[data-attendance-student],[data-records-finalize],.attendance-actions")'),false);
   assert.equal(await page.evaluate('document.querySelector("[data-attendance-status]").textContent'),'Present');
   const [[a]]=await db.execute('SELECT status,finalized_at FROM attendance WHERE session_id=? AND student_user_id=?',[active,users[1].id]);assert.equal(a.status,'Present');assert.equal(a.finalized_at,null);await close();
  });
  await check('04 automatic attendance survives refresh; session end finalizes never-joined Students as Absent',async()=>{
   await page.command('Page.reload');await page.wait('!!window.ClassenceRealtime?.data');await open('attendance');assert.equal(await page.evaluate('document.querySelector("[data-attendance-status]").textContent'),'Present');await close();
   await page.click('[data-rt=end]');await page.wait('!document.querySelector("[data-rt=end]")');await open('attendance');assert(await page.evaluate('document.querySelector("[data-attendance-page]").textContent.includes("Finalized")'));assert.equal(await page.evaluate('[...document.querySelectorAll("[data-attendance-status]")].filter(s=>s.textContent==="Absent").length'),3);
  });
  await check('05 Review Session Logs retained; audit and explicit correction API preserved without View History',async()=>{
   assert.equal(await page.evaluate('!!document.querySelector("[data-records-history],#attendance-history,.attendance-review,.attendance-audit")'),false);
   const logButton=await page.evaluate('({session:document.querySelector("[data-page=logs][data-session]").dataset.session,classId:document.querySelector("[data-page=logs][data-session]").dataset.class})');assert.equal(logButton.session,active);assert.equal(logButton.classId,String(realClass.id));
   await page.click('[data-page=logs][data-session]');await page.wait('document.querySelector("h1")?.textContent==="Activity Logs"');
   assert.equal(await page.evaluate('state.sessionId'),active);
   const [logs]=await db.execute('SELECT event_type FROM activity_logs WHERE session_id=? ORDER BY id',[active]);assert(logs.some(r=>r.event_type==='Session Ended'));assert(await page.evaluate('document.querySelector("#view").textContent.includes("Session Ended")'));
   const correction=await page.evaluate('(async()=>{const path="/api/auth/live/sessions/"+'+JSON.stringify(active)+'+"/attendance";let r=(await FacultyAPI.request(path)).data;r=(await FacultyAPI.request(path+"/reopen",{method:"POST",body:JSON.stringify({version:r.version,reason:"Corrected after Faculty review."})})).data;r=(await FacultyAPI.request(path,{method:"PATCH",body:JSON.stringify({version:r.version,changes:[{studentId:'+JSON.stringify(String(users[1].id))+',status:"Late"}]})})).data;return (await FacultyAPI.request(path+"/finalize",{method:"POST",body:JSON.stringify({version:r.version})})).data;})()');
   assert(correction.finalized);assert(correction.audit.some(a=>a.action==='Reopened'&&a.reason==='Corrected after Faculty review.'));await open('attendance');assert.equal(await page.evaluate('document.querySelector("[data-attendance-status]").textContent'),'Late');await close();
  });
  await check('06 older session attendance after a newer session, refresh and relogin',async()=>{
   await page.evaluate("navigate('details',"+JSON.stringify(String(realClass.id))+")");await page.click('[data-action=start]');await page.wait('!!document.querySelector("[data-rt=end]")');await page.click('[data-action=logout]');await page.wait('!!document.querySelector("[data-form=login]")');await login();await page.command('Page.reload');await page.wait('!!window.ClassenceRealtime?.data');await open('attendance');
   await page.evaluate('FacultyRecords.open("attendance",'+JSON.stringify(String(realClass.id))+','+JSON.stringify(active)+')');await page.wait('document.querySelector("[data-attendance-status]")?.textContent==="Late"');
   const audit=await page.evaluate('FacultyAPI.request("/api/auth/live/sessions/"+'+JSON.stringify(active)+'+"/attendance")');assert(audit.data.audit.some(a=>a.reason==='Corrected after Faculty review.'));
   assert.equal(await page.evaluate('document.querySelector("#faculty-records-dialog").open'),false,'Attendance uses the normal page, not a modal');
   assert.equal(await page.evaluate('document.querySelector(".sidebar [aria-current=page]").textContent'),'Attendance');
   assert.equal(await page.evaluate('document.body.textContent.includes("Manage Database-backed Attendance")'),false);
   for(const width of [1920,1366,1024,768,640,375,320]){await page.command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});assert(await page.evaluate('document.querySelector("[data-attendance-page]").getBoundingClientRect().right<=innerWidth && document.documentElement.scrollWidth<=innerWidth && [...document.querySelectorAll("[data-attendance-page] .tablewrap")].every(el=>el.getBoundingClientRect().right<=innerWidth)'), 'Page fits with original contained table scrolling at '+width);}
   await page.command('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
   await page.command('Network.setBlockedURLs',{urls:[base+'/api/*']});
   assert.equal(await page.evaluate('document.querySelector("h1").textContent'),'Session Summary');
   assert.equal(await page.evaluate('document.querySelector("#faculty-records-dialog").open'),false);
   await page.evaluate("navigate('attendance')");await page.evaluate('FacultyRecords.open("attendance",'+JSON.stringify(String(realClass.id))+','+JSON.stringify(active)+')');
   await page.wait('document.querySelector("[data-attendance-page]")?.textContent.includes("Attendance unavailable")');
   assert(await page.evaluate('!!document.querySelector(".sidebar") && !document.querySelector("#faculty-records-dialog").open'));
   await page.command('Network.setBlockedURLs',{urls:[]});await page.click('[data-records-retry]');await page.wait('!!document.querySelector("[data-attendance-status]")');
   if(process.env.CLASSENCE_ATTENDANCE_SCREENSHOT){const image=await page.command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(process.env.CLASSENCE_ATTENDANCE_SCREENSHOT,Buffer.from(image.data,'base64'));}
   assert.equal(await page.evaluate('localStorage.getItem("classwatch-demo-v2")'),'original records preserved');
  });
  const errors=chrome.events.filter(e=>e.method==='Runtime.exceptionThrown'||e.method==='Log.entryAdded'&&/Content Security Policy|CORS policy/i.test(e.params.entry.text));assert.deepEqual(errors,[]);
  await chrome.close();chrome=null;await realtime.close();realtime=null;await db.rollback();for(const t of tables){const [[r]]=await db.query('SELECT COUNT(*) n FROM '+t);assert.equal(r.n,before[t],t+' cleanup');}console.log('PASS STEP9 CHROME: 07 original records/prototype storage preserved; full fixture rollback; no runtime/CSP/CORS errors.');cases++;
  console.log('STEP9 CHROME SUMMARY: '+cases+' cases passed, 0 failed.');
 }finally{if(chrome)await chrome.close();if(realtime)await realtime.close();if(server?.listening)await new Promise(r=>server.close(r));if(preview)await new Promise(r=>preview.close(r));await db.rollback();db.release();await pool.end();}
})().catch(error=>{console.error('Step 9 Chrome failed:',error.code||error.message);console.error(error.stack?.split('\n').filter(l=>l.includes('faculty-records-browser')).join('\n'));process.exitCode=1;});
