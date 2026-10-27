'use strict';
require('dotenv').config({path:require('node:path').join(__dirname,'../.env'),quiet:true});
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os');
const pool=require('../src/config/database'),chromePipe=require('./chrome-pipe.cjs'),{setup}=require('../src/index'),{attachRealtime}=require('../src/realtime'),{createAuthService}=require('../src/services/authService');
(async()=>{
  const db=await pool.getConnection(),browsers=[];let preview,server,realtime;
  const tables=['users','faculty_profiles','student_profiles','auth_sessions','classes','enrollments','sessions','attendance','session_participants','session_connection_intervals','activity_logs'],before={};
  try{
    for(const t of tables){const [[r]]=await db.query('SELECT COUNT(*) n FROM `'+t+'`');before[t]=r.n;}await db.beginTransaction();
    const testPool={execute:(...a)=>db.execute(...a),query:(...a)=>db.query(...a),getConnection:async()=>({execute:(...a)=>db.execute(...a),query:(...a)=>db.query(...a),beginTransaction:()=>db.query('SAVEPOINT browser_rt'),commit:()=>db.query('RELEASE SAVEPOINT browser_rt'),rollback:()=>db.query('ROLLBACK TO SAVEPOINT browser_rt'),release(){}})};
    const uid=crypto.randomUUID(),password='BrowserRealtime123!',auth=createAuthService(testPool,900),users=[];
    for(const [i,role]of ['faculty','student','student'].entries())users.push(await auth.register(role,{email:`browser-rt-${i}-${uid}@example.edu`,password,fullName:'Browser Person '+i,facultyId:'F-'+uid,department:'Computing',academicPosition:'Professor',studentId:'S-'+i+'-'+uid,program:'BSIT',yearLevel:3,section:'BSIT 3-1'}));
    const root=path.resolve(__dirname,'../../frontend');let base;
    preview=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;const file=path.resolve(root,'.'+(pathname.endsWith('/')?pathname+'index.html':pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}try{let data=fs.readFileSync(file);if(file.endsWith('index.html'))data=data.toString().replace('content="http://127.0.0.1:3000"','content="'+base+'"');res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'image/jpeg');res.end(data);}catch{res.writeHead(404);res.end();}});
    await new Promise(r=>preview.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+preview.address().port;
    const extensionId='jefdcdmlgafknafmpdondeglcbimdnki',extensionOrigin='chrome-extension://'+extensionId;process.env.CLIENT_ORIGIN=origin+','+extensionOrigin;
    const instance=setup({pool:testPool});server=http.createServer(instance.app);

    realtime=await attachRealtime(server,testPool,[origin,extensionOrigin],{lockName:'rt_browser_'+uid,reconcileClassIds:['18446744073709551615']});instance.app.locals.realtime=realtime;
    await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
    const testDir=fs.mkdtempSync(path.join(os.tmpdir(),'classence-rt-browser-')),extensionPath=path.join(testDir,'extension');fs.cpSync(path.join(root,'student'),extensionPath,{recursive:true});const index=path.join(extensionPath,'index.html');fs.writeFileSync(index,fs.readFileSync(index,'utf8').replace('content="http://127.0.0.1:3000"','content="'+base+'"'));
    fs.writeFileSync(path.join(extensionPath,'js/monitoring-config.js'),'globalThis.CLASSENCE_MONITORING_API='+JSON.stringify(base)+';');
    const chrome=await chromePipe();browsers.push(chrome);const teacher=await chrome.open(origin+'/teacher/',base);
    await teacher.input('#email',users[0].email);await teacher.input('#password',password);await teacher.evaluate('document.querySelector("[data-form=login]").requestSubmit()');await teacher.wait('!!FacultyAPI.current && !!ClassenceRealtime.data');
    await teacher.evaluate("navigate('create')");
    for(const [name,value]of Object.entries({name:'Actual Browser Class',section:'BSIT 3-1',meet:'https://meet.google.com/abc-defg-hij'}))await teacher.input('#'+name,value);
    await teacher.evaluate('document.querySelector("[data-form=class]").requestSubmit()');await teacher.wait('!!document.querySelector(".class-title-row")');await teacher.evaluate("navigate('monitor')");
    const [[realClass]]=await db.execute('SELECT id,class_code FROM classes WHERE faculty_user_id=?',[users[0].id]);assert(realClass);
    const studentPages=[];
    for(const n of [1,2]){
      const browser=await chromePipe();browsers.push(browser);await browser.send('Extensions.loadUnpacked',{path:extensionPath});const page=await browser.open(extensionOrigin+'/index.html',base);studentPages.push(page);
      await page.input('#email',users[n].email);await page.input('#password',password);await page.evaluate('document.querySelector("[data-form=login]").requestSubmit()');try{await page.wait('!!StudentAPI.current && document.querySelector("[data-rt-status]")?.textContent==="Connected"');}catch(e){console.log('Student connect diagnostic',await page.evaluate('({signedIn:!!StudentAPI.current,feedback:document.querySelector("#feedback")?.textContent,status:document.querySelector("[data-rt-status]")?.textContent})'));throw e;}
      await page.click('[data-page=classes]');await page.wait('!!document.querySelector("[data-page=enroll]")');await page.click('[data-page=enroll]');await page.wait('!!document.querySelector("[data-form=enroll]")');await page.input('#code',realClass.class_code);await page.evaluate('document.querySelector("[data-form=enroll]").requestSubmit()');await page.wait('!!document.querySelector("[data-real-class]")');
    }
    await teacher.evaluate("navigate('details',db.classes[0].id)");await teacher.click('[data-action=start]');await teacher.wait('!!document.querySelector("[data-rt=end]")');
    for(const page of studentPages){await page.wait('!!document.querySelector("[data-rt=join]")');await page.click('[data-rt=join]');await page.wait('document.querySelector("[data-rt-connection]")?.textContent.includes("Connected · Joined")');}
    await teacher.wait('[...document.querySelectorAll(".historical-monitor tbody tr")].filter(row=>row.cells[1]?.textContent==="Online").length===2');
    const [[session]]=await db.execute('SELECT id FROM sessions WHERE class_id=? AND status=\'Live\'',[realClass.id]);const [[first]]=await db.execute('SELECT first_joined_at FROM session_participants WHERE session_id=? AND student_user_id=?',[session.id,users[1].id]);

    await studentPages[0].close();await teacher.wait('[...document.querySelectorAll(".historical-monitor tbody tr")].some(row=>row.textContent.includes("Browser Person 1")&&row.cells[1]?.textContent==="Offline")');
    studentPages[0]=await browsers[1].open(extensionOrigin+'/index.html',base);await studentPages[0].wait('document.querySelector("[data-rt-connection]")?.textContent.includes("Connected · Joined")');
    assert.equal(await studentPages[0].evaluate('StudentAPI.current.email'),users[1].email);
    await teacher.wait('[...document.querySelectorAll(".historical-monitor tbody tr")].filter(row=>row.cells[1]?.textContent==="Online").length===2');
    await studentPages[0].click('[data-rt=leave]');await teacher.wait('[...document.querySelectorAll(".historical-monitor tbody tr")].some(row=>row.textContent.includes("Browser Person 1")&&row.cells[1]?.textContent==="Offline")');
    await studentPages[0].wait('!!document.querySelector("[data-rt=join]:not(:disabled)")');await studentPages[0].click('[data-rt=join]');await studentPages[0].wait('document.querySelector("[data-rt-connection]")?.textContent.includes("Connected · Joined")');
    const [[again]]=await db.execute('SELECT first_joined_at FROM session_participants WHERE session_id=? AND student_user_id=?',[session.id,users[1].id]);assert.equal(again.first_joined_at.getTime(),first.first_joined_at.getTime());

    for(const socket of realtime.io.sockets.sockets.values())socket.conn.close();
    await teacher.wait('ClassenceRealtime.state.connection!=="CONNECTED"');
    await teacher.wait('ClassenceRealtime.state.connection==="CONNECTED"');for(const page of studentPages)await page.wait('document.querySelector("[data-rt-connection]")?.textContent.includes("Connected · Joined")');
    await teacher.wait('!!document.querySelector("[data-rt=end]:not(:disabled)")');await teacher.click('[data-rt=end]');await teacher.wait('document.querySelector("#view")?.textContent.includes("No active session")');for(const page of studentPages)await page.wait('document.querySelector("#view")?.textContent.includes("No active session")');
    await db.execute('UPDATE auth_sessions SET revoked_at=UTC_TIMESTAMP(3) WHERE user_id=? AND revoked_at IS NULL',[users[2].id]);await studentPages[1].wait('!StudentAPI.current && !!document.querySelector("[data-form=login]")');assert(await studentPages[1].evaluate('chrome.storage.local.get("classence-student-session").then(data=>!data["classence-student-session"])'));
    for(const browser of browsers){const errors=browser.events.filter(evt=>evt.method==='Runtime.exceptionThrown'||evt.method==='Log.entryAdded'&&/Content Security Policy|CORS policy/i.test(evt.params.entry.text));assert.equal(errors.length,0,JSON.stringify(errors));}
    console.log('PASS: actual Faculty browser and two isolated Chrome extension clients: real class creation/enrollment, start notification, two joins, live dashboard updates, popup-context close/reopen auto-rejoin, explicit leave/rejoin, transport reconnection, authoritative snapshots, immutable first join and session end; no runtime/CSP/CORS errors.');
    for(const browser of browsers)await browser.close();browsers.length=0;await realtime.close();realtime=null;await db.rollback();for(const t of tables){const [[r]]=await db.query('SELECT COUNT(*) n FROM `'+t+'`');assert.equal(r.n,before[t]);}console.log('PASS: all browser/database fixtures rolled back; original records preserved.');
  }finally{for(const browser of browsers)await browser.close();if(realtime)await realtime.close();if(preview)await new Promise(r=>preview.close(r));if(server?.listening)await new Promise(r=>server.close(r));await db.rollback();db.release();await pool.end();}
})().catch(e=>{console.error('Real-time browser tests failed:',e.code||e.message);if(e.stack)console.error(e.stack.split('\n').filter(line=>line.includes('realtime-browser.cjs')).join('\n'));process.exitCode=1;});
