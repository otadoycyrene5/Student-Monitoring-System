'use strict';
require('dotenv').config({path:require('node:path').join(__dirname,'../.env'),quiet:true});
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os');
const pool=require('../src/config/database'),chromePipe=require('./chrome-pipe.cjs'),{setup}=require('../src/index'),{attachRealtime}=require('../src/realtime'),{createAuthService}=require('../src/services/authService');
(async()=>{
  const db=await pool.getConnection(),browsers=[];let preview,server,realtime;
  const tables=['meet_monitoring','users','faculty_profiles','student_profiles','auth_sessions','classes','enrollments','sessions','attendance','session_participants','session_connection_intervals','activity_logs'],before={};
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
    const chrome=await chromePipe();browsers.push(chrome);const teacher=await chrome.open(origin+'/teacher/',base);
    await teacher.input('#email',users[0].email);await teacher.input('#password',password);await teacher.evaluate('document.querySelector("[data-form=login]").requestSubmit()');await teacher.wait('!!FacultyAPI.current && !!ClassenceRealtime.data');
    await teacher.evaluate("navigate('create')");
    for(const [name,value]of Object.entries({name:'Actual Browser Class',section:'BSIT 3-1',meet:'https://meet.google.com/abc-defg-hij'}))await teacher.input('#'+name,value);
    await teacher.evaluate('document.querySelector("[data-form=class]").requestSubmit()');await teacher.wait('!!document.querySelector(".class-title-row")');await teacher.evaluate("navigate('monitor')");
    const [[realClass]]=await db.execute('SELECT id,class_code FROM classes WHERE faculty_user_id=?',[users[0].id]);assert(realClass);
    fs.writeFileSync(path.join(extensionPath,'js/monitoring-config.js'),"globalThis.CLASSENCE_MONITORING_API="+JSON.stringify(base)+";");
    fs.writeFileSync(path.join(extensionPath,'controller.html'),'<html><body>Isolated test controller</body></html>');
    const profile=path.join(testDir,'student-profile');let browser=await chromePipe(profile);browsers.push(browser);
    await browser.send('Extensions.loadUnpacked',{path:extensionPath});let student=await browser.open(extensionOrigin+'/index.html',base);
    await student.input('#email',users[1].email);await student.input('#password',password);await student.evaluate('document.querySelector("[data-form=login]").requestSubmit()');await student.wait('!!StudentAPI.current && document.querySelector("[data-rt-status]")?.textContent==="Connected"');
    await student.click('[data-page=classes]');await student.wait('!!document.querySelector("[data-page=enroll]")');await student.click('[data-page=enroll]');await student.wait('!!document.querySelector("[data-form=enroll]")');await student.input('#code',realClass.class_code);await student.evaluate('document.querySelector("[data-form=enroll]").requestSubmit()');await student.wait('!!document.querySelector("[data-real-class]")');
    await teacher.evaluate("navigate('details',db.classes[0].id)");await teacher.click('[data-action=start]');await student.wait('!!document.querySelector("[data-rt=join]")');await student.click('[data-rt=join]');await student.wait('!!document.querySelector("[data-monitor=start]")');
    const [[activeSession]]=await db.execute("SELECT id FROM sessions WHERE class_id=? AND status='Live'",[realClass.id]);
    const [[noConsent]]=await db.execute('SELECT COUNT(*) n FROM meet_monitoring WHERE session_id=?',[activeSession.id]);assert.equal(noConsent.n,0);

    let ctlTarget=await browser.send('Target.createTarget',{url:extensionOrigin+'/controller.html'});let {sessionId:ctlSession}=await browser.send('Target.attachToTarget',{targetId:ctlTarget.targetId,flatten:true});
    const ctl=async expression=>{const r=await browser.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true},ctlSession).catch(e=>{throw Error('Popup controller: '+e.message);});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
    await student.close();
    const wait=async check=>{for(let i=0;i<200;i++){if(await check())return;await new Promise(r=>setTimeout(r,50));}throw new Error('Meet Chrome scenario timed out.');};
    let popupPage=null;


    const popup=async()=>{
      await wait(()=>ctl('typeof chrome!=="undefined" && !!chrome.action?.openPopup'));
      if(popupPage&&(await browser.send('Target.getTargets')).targetInfos.some(t=>t.targetId===popupPage.targetId))return popupPage;
      for(let attempt=0;attempt<3;attempt++){
        let target;
        try{
          await browser.send('Target.activateTarget',{targetId:ctlTarget.targetId});


          await ctl('window.__popupOpeningError=null;chrome.action.openPopup().catch(e=>{window.__popupOpeningError=String(e.message)});true');
          await wait(async()=>{target=(await browser.send('Target.getTargets')).targetInfos.find(t=>t.url===extensionOrigin+'/index.html');if(!target){const error=await ctl('window.__popupOpeningError');if(error)throw Error('Chrome popup opening failed: '+error);}return target;});
          const {sessionId}=await browser.send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
          await browser.send('Runtime.enable',{},sessionId);
          const evaluate=async expression=>{const r=await browser.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true},sessionId).catch(e=>{throw Error('Native popup: '+e.message);});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
          const ready=async expression=>{await wait(()=>evaluate(expression));};
          const page={targetId:target.targetId,sessionId,evaluate,wait:ready,click:selector=>evaluate('document.querySelector('+JSON.stringify(selector)+').click()'),input:(selector,value)=>evaluate('document.querySelector('+JSON.stringify(selector)+').value='+JSON.stringify(value)),close:()=>browser.send('Target.closeTarget',{targetId:target.targetId})};
          await ready('!!document.querySelector("[data-monitor=start], [data-monitor=stop], [data-form=login]")');popupPage=page;return page;
        }catch(error){if(attempt===2||! /Session with given id not found|No target with given id|Target closed|target.*closed/i.test(error.message))throw error;popupPage=null;}
      }
    };

    let actualPopup=await popup();await actualPopup.click('[data-monitor=start]');await actualPopup.wait('!!document.querySelector("[data-monitor=stop]")');

    const meetTab=async(code)=>{const previous=await ctl('chrome.tabs.query({url:"https://meet.google.com/'+code+'"}).then(t=>t.map(t=>t.id))');const target=await browser.send('Target.createTarget',{url:'about:blank'});const {sessionId}=await browser.send('Target.attachToTarget',{targetId:target.targetId,flatten:true});await browser.send('Page.enable',{},sessionId);await browser.send('Fetch.enable',{patterns:[{urlPattern:'https://meet.google.com/*',resourceType:'Document',requestStage:'Request'}]},sessionId);const from=browser.events.length;const navigation=browser.send('Page.navigate',{url:'https://meet.google.com/'+code},sessionId);let paused;await wait(()=>{paused=browser.events.slice(from).find(e=>e.method==='Fetch.requestPaused'&&e.sessionId===sessionId);return paused;});await browser.send('Fetch.fulfillRequest',{requestId:paused.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/html'}],body:Buffer.from('<html><body>Inert tab metadata fixture</body></html>').toString('base64')},sessionId);await navigation;const tab=await ctl('chrome.tabs.query({url:"https://meet.google.com/'+code+'"}).then(t=>t.find(t=>!'+JSON.stringify(previous)+'.includes(t.id)))');return {...target,tabId:tab.id,windowId:tab.windowId};};
    const designated=await meetTab('abc-defg-hij');await ctl('chrome.tabs.update('+designated.tabId+',{active:true}).then(()=>chrome.windows.update('+designated.windowId+',{focused:true}))');
    if((await browser.send('Target.getTargets')).targetInfos.some(t=>t.targetId===actualPopup.targetId))await actualPopup.close();
    const observed=async expected=>{const [[r]]=await db.execute('SELECT tab_state FROM meet_monitoring WHERE session_id=?',[activeSession.id]);return r?.tab_state===expected;};
    await wait(()=>observed('MEET_TAB_SELECTED'));await teacher.wait('document.querySelector("[data-meet-health]")?.dataset.meetState==="MEET_TAB_SELECTED"');await teacher.wait('(()=>{const text=document.querySelector(".historical-monitor tbody tr")?.cells[1].textContent||"";return text.includes("Online")&&text.includes("Popup: Offline");})()');
    await teacher.wait('document.querySelector(".historical-monitor tbody tr")?.cells[3].textContent==="Active"');
    await teacher.wait('document.querySelector(".historical-monitor tbody tr")?.cells[4].textContent==="Present"');
    if(process.env.CLASSENCE_RENEWAL_TEST==='1')await require('./renewal-browser-hooks.cjs').student({db,ctl,wait,users,activeSession,popup});
    const unrelated=await ctl('chrome.tabs.create({url:"about:blank",active:true})');await wait(()=>observed('MEET_TAB_NOT_SELECTED'));await teacher.wait('document.querySelector("[data-meet-health]")?.dataset.meetState==="MEET_TAB_NOT_SELECTED"');
    await teacher.wait('document.querySelector(".historical-monitor tbody tr")?.cells[3].textContent==="On Another Tab"');
    await db.execute("UPDATE activity_logs l JOIN meet_monitoring m ON m.session_id=l.session_id AND m.student_user_id=l.student_user_id AND JSON_UNQUOTE(JSON_EXTRACT(l.event_details,'$.eventId'))=m.last_event_id SET l.event_details=JSON_SET(l.event_details,'$.unfocusedSince',?) WHERE m.session_id=?",[new Date(Date.now()-300001).toISOString(),activeSession.id]);
    await teacher.evaluate('ClassenceRealtime.refresh()');await teacher.wait('document.querySelector(".historical-monitor tbody tr")?.cells[3].textContent==="Inactive"');
    assert.equal(await teacher.evaluate('document.querySelector(".historical-monitor tbody tr").cells[4].textContent'),'Present');
    await db.execute('UPDATE meet_monitoring SET last_report_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 76 SECOND) WHERE session_id=?',[activeSession.id]);
    await teacher.evaluate('ClassenceRealtime.refresh()');await teacher.wait('document.querySelector(".historical-monitor tbody tr")?.cells[3].textContent==="Not Monitoring"');
    await ctl('chrome.tabs.update('+designated.tabId+',{active:true})');await wait(()=>observed('MEET_TAB_SELECTED'));
    await teacher.wait('document.querySelector(".historical-monitor tbody tr")?.cells[3].textContent==="Active"');
    await ctl('chrome.tabs.remove('+designated.tabId+')');await wait(()=>observed('MEET_TAB_CLOSED'));await teacher.wait('document.querySelector("[data-meet-health]")?.dataset.meetState==="MEET_TAB_CLOSED"');
    await teacher.wait('document.querySelector(".historical-monitor tbody tr")?.cells[3].textContent==="Not Monitoring"');
    console.log('PASS ACTIVITY CHROME: focus Active; popup closed stays Active; unfocused On Another Tab; accelerated five-minute evidence gives Present + Inactive; stale reports Not Monitoring; focus resets; missing Meet Not Monitoring.');
    console.log('PASS: actual toolbar consent, popup closed, designated Meet selected/unselected/selected/closed, background REST persistence and Faculty updates.');
    if(process.env.CLASSENCE_RECOVERY_TEST==='1')await require('./recovery-browser-hooks.cjs')({teacher,browser,ctl,db,realtime,users,activeSession,realClass,wait,extensionOrigin});
    const wrong=await meetTab('xyz-abcd-efg');await ctl('chrome.tabs.update('+wrong.tabId+',{active:true})');await new Promise(r=>setTimeout(r,500));assert(await observed('MEET_TAB_CLOSED'));
    const first=await meetTab('abc-defg-hij'),second=await meetTab('abc-defg-hij');await ctl('chrome.tabs.update('+second.tabId+',{active:true})');await wait(()=>observed('MEET_TAB_SELECTED'));await ctl('chrome.tabs.remove('+first.tabId+')');assert(await observed('MEET_TAB_SELECTED'));
    const newWindow=await ctl('chrome.windows.create({url:"about:blank",focused:true})');await wait(()=>observed('MEET_TAB_NOT_SELECTED'));await ctl('chrome.windows.remove('+newWindow.id+')');await ctl('chrome.windows.update('+second.windowId+',{focused:true})');await wait(()=>observed('MEET_TAB_SELECTED'));

    await browser.send('ServiceWorker.enable',{},ctlSession);let version;await wait(()=>{version=browser.events.filter(e=>e.method==='ServiceWorker.workerVersionUpdated').flatMap(e=>e.params.versions).find(v=>v.scriptURL===extensionOrigin+'/js/background.js'&&v.status==='activated');return version;});await browser.send('ServiceWorker.stopWorker',{versionId:version.versionId},ctlSession);
    await ctl('chrome.tabs.update('+unrelated.id+',{active:true})');await wait(()=>observed('MEET_TAB_NOT_SELECTED'));

    const apiPort=server.address().port;await realtime.close();realtime=null;await teacher.wait('ClassenceRealtime.state.connection!=="CONNECTED"');
    server=http.createServer(instance.app);realtime=await attachRealtime(server,testPool,[origin,extensionOrigin],{lockName:'rt_browser_'+uid,reconcileClassIds:[String(realClass.id)]});instance.app.locals.realtime=realtime;await new Promise(r=>server.listen(apiPort,'127.0.0.1',r));
    await teacher.wait('ClassenceRealtime.state.connection==="CONNECTED"');await ctl('chrome.tabs.update('+second.tabId+',{active:true})');await wait(()=>observed('MEET_TAB_SELECTED'));

    const [[originalGrant]]=await db.execute('SELECT grant_id,last_sequence FROM meet_monitoring WHERE session_id=?',[activeSession.id]);
    await browser.close();browsers.pop();popupPage=null;await new Promise(r=>setTimeout(r,500));browser=await chromePipe(profile);browsers.push(browser);await browser.send('Extensions.loadUnpacked',{path:extensionPath});
    ctlTarget=await browser.send('Target.createTarget',{url:extensionOrigin+'/controller.html'});({sessionId:ctlSession}=await browser.send('Target.attachToTarget',{targetId:ctlTarget.targetId,flatten:true}));
    await wait(()=>observed('MEET_TAB_CLOSED'));const [[restored]]=await db.execute('SELECT grant_id,last_sequence FROM meet_monitoring WHERE session_id=?',[activeSession.id]);assert.equal(restored.grant_id,originalGrant.grant_id);assert(restored.last_sequence>originalGrant.last_sequence);
    actualPopup=await popup();await actualPopup.wait('!!document.querySelector("[data-monitor=stop]")');assert.equal(await actualPopup.evaluate('StudentAPI.current.email'),users[1].email);
    await actualPopup.click('[data-monitor=stop]');await actualPopup.wait('!!document.querySelector("[data-monitor=start]")');await wait(async()=>{const [[row]]=await db.execute('SELECT consent_active FROM meet_monitoring WHERE session_id=?',[activeSession.id]);return row.consent_active===0;});const [[stopped]]=await db.execute('SELECT consent_active,last_sequence FROM meet_monitoring WHERE session_id=?',[activeSession.id]);assert.equal(stopped.consent_active,0);await teacher.wait('document.querySelector(".historical-monitor tbody tr")?.cells[3].textContent==="Not Monitoring"');
    if((await browser.send('Target.getTargets')).targetInfos.some(t=>t.targetId===actualPopup.targetId))await actualPopup.close();await ctl('chrome.tabs.create({url:"about:blank",active:true})');await new Promise(r=>setTimeout(r,500));const [[afterStop]]=await db.execute('SELECT last_sequence FROM meet_monitoring WHERE session_id=?',[activeSession.id]);assert.equal(afterStop.last_sequence,stopped.last_sequence);
    console.log('PASS: wrong meeting ignored, duplicate matching tabs, multiple windows/focus, actual worker termination/wake, backend restart, full Chrome restart with verified original consent, popup state restoration, withdrawal stops reports.');
    actualPopup=await popup();await actualPopup.click('[data-monitor=start]');await actualPopup.wait('!!document.querySelector("[data-monitor=stop]")');
    await actualPopup.click('[data-page=profile]');await actualPopup.wait('!!document.querySelector("[data-action=logout]")');await actualPopup.click('[data-action=logout]');await actualPopup.wait('document.querySelector("#confirmation").open');await actualPopup.evaluate('window.__testLogoutComplete=false;const originalTestLogout=StudentAPI.logout;StudentAPI.logout=async(...args)=>{try{return await originalTestLogout(...args);}finally{window.__testLogoutComplete=true;}}');await actualPopup.click('[data-confirm]');await actualPopup.wait('window.__testLogoutComplete && !!document.querySelector("[data-form=login]")');
    const [[logoutGrant]]=await db.execute('SELECT consent_active FROM meet_monitoring WHERE session_id=?',[activeSession.id]);assert.equal(logoutGrant.consent_active,0);assert(await ctl('chrome.storage.local.get("classence-student-session").then(d=>!d["classence-student-session"])'));
    console.log('PASS: logout during active monitoring withdraws consent, revokes credentials and returns to Login.');

    const signInAgain=async()=>{
      await actualPopup.wait('!authBusy && !StudentAPI.checking');
      await actualPopup.input('#email',users[1].email);await actualPopup.input('#password',password);
      await actualPopup.evaluate('document.querySelector("[data-form=login]").requestSubmit()');
      try{await actualPopup.wait('!!StudentAPI.current && document.querySelector("[data-rt-status]")?.textContent==="Connected"');}catch(error){console.log('Sign-in diagnostic',await actualPopup.evaluate('({signedIn:!!StudentAPI.current,checking:StudentAPI.checking,busy:authBusy,status:document.querySelector("[data-rt-status]")?.textContent,feedback:document.querySelector("#feedback")?.textContent})'));throw error;}
      await actualPopup.wait('!!document.querySelector("[data-monitor=start]")');
    };
    await signInAgain();

    const [[beforeRenewedConsent]]=await db.execute('SELECT consent_active FROM meet_monitoring WHERE session_id=?',[activeSession.id]);assert.equal(beforeRenewedConsent.consent_active,0);
    await actualPopup.click('[data-monitor=start]');await actualPopup.wait('!!document.querySelector("[data-monitor=stop]")');
    if(process.env.CLASSENCE_FULL_DURATION==='1'){
      const [[issued]]=await db.execute('SELECT created_at,expires_at FROM auth_sessions WHERE user_id=? AND revoked_at IS NULL ORDER BY id DESC LIMIT 1',[users[1].id]);
      assert(Math.abs((+issued.expires_at- +issued.created_at)-900000)<1000,'Original access lifetime must remain 900 seconds');
      const [[original]]=await db.execute('SELECT grant_id FROM meet_monitoring WHERE session_id=?',[activeSession.id]);
      await actualPopup.close();let naturalGap=false;
      console.log('SOAK: waiting beyond original 900-second access expiry with popup closed; automatic renewal must preserve consent.');
      while(Date.now()<+issued.expires_at+1500){const targets=(await browser.send('Target.getTargets')).targetInfos;if(!targets.some(t=>t.type==='service_worker'&&t.url===extensionOrigin+'/js/background.js'))naturalGap=true;await new Promise(r=>setTimeout(r,Math.min(10000,Math.max(100,+issued.expires_at+1500-Date.now()))));}
      const [[renewed]]=await db.execute('SELECT expires_at FROM auth_sessions WHERE user_id=? AND revoked_at IS NULL ORDER BY id DESC LIMIT 1',[users[1].id]);assert(+renewed.expires_at>+issued.expires_at);
      const [[current]]=await db.execute('SELECT grant_id,consent_active FROM meet_monitoring WHERE session_id=?',[activeSession.id]);assert.equal(current.grant_id,original.grant_id);assert.equal(current.consent_active,1);
      actualPopup=await popup();assert.equal(await actualPopup.evaluate('StudentAPI.current.email'),users[1].email);
      console.log('SOAK: natural 900-second renewal verified; natural worker gap observed='+naturalGap+'. Now testing accelerated absolute expiry separately.');
    }
    await db.execute('UPDATE session_families SET absolute_expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE user_id=? AND revoked_at IS NULL',[users[1].id]);
    await actualPopup.wait('!!document.querySelector("[data-form=login]")');
    await wait(()=>ctl('chrome.storage.local.get("classence-meet-monitoring").then(d=>d["classence-meet-monitoring"]?.consent===false)'));
    const [[expiredCursor]]=await db.execute('SELECT last_sequence FROM meet_monitoring WHERE session_id=?',[activeSession.id]);
    await ctl('chrome.tabs.create({url:"about:blank",active:true})');await new Promise(r=>setTimeout(r,500));
    const [[noExpiredReports]]=await db.execute('SELECT last_sequence FROM meet_monitoring WHERE session_id=?',[activeSession.id]);assert.equal(noExpiredReports.last_sequence,expiredCursor.last_sequence);
    console.log('PASS: actual popup returns to Login on '+'accelerated absolute session'+' expiry; worker consent stops and later tab changes submit no reports.');
    actualPopup=await popup();await signInAgain();await actualPopup.click('[data-monitor=start]');await actualPopup.wait('!!document.querySelector("[data-monitor=stop]")');
    await teacher.click('[data-rt=end]');await teacher.wait('!document.querySelector("[data-rt=end]")');
    await ctl('chrome.tabs.create({url:"about:blank",active:true})');
    await wait(()=>ctl('chrome.storage.local.get("classence-meet-monitoring").then(d=>d["classence-meet-monitoring"]?.consent===false)'));
    const [[endedGrant]]=await db.execute('SELECT consent_active,stop_reason FROM meet_monitoring WHERE session_id=?',[activeSession.id]);assert.equal(endedGrant.consent_active,0);assert.equal(endedGrant.stop_reason,'SESSION_ENDED');
    console.log('PASS: Faculty session termination revokes the grant and stops the actual background worker.');
    if(process.env.CLASSENCE_RENEWAL_TEST==='1')await require('./renewal-browser-hooks.cjs').account({browser,extensionOrigin,base,users,password});
    for(const browser of browsers){const errors=browser.events.filter(evt=>evt.method==='Runtime.exceptionThrown'||evt.method==='Log.entryAdded'&&/Content Security Policy|CORS policy/i.test(evt.params.entry.text));assert.equal(errors.length,0,JSON.stringify(errors));}
    console.log('PASS: actual Meet-only monitoring Chrome scenario; no runtime/CSP/CORS errors.');
    for(const browser of browsers)await browser.close();browsers.length=0;await realtime.close();realtime=null;await db.rollback();for(const t of tables){const [[r]]=await db.query('SELECT COUNT(*) n FROM `'+t+'`');assert.equal(r.n,before[t]);}console.log('PASS: all browser/database fixtures rolled back; original records preserved.');
  }finally{for(const browser of browsers)await browser.close();if(realtime)await realtime.close();if(preview)await new Promise(r=>preview.close(r));if(server?.listening)await new Promise(r=>server.close(r));await db.rollback();db.release();await pool.end();}
})().catch(e=>{console.error('Meet monitoring Chrome tests failed:',e.code||e.message);if(e.stack)console.error(e.stack.split('\n').filter(line=>line.includes('meet-monitoring-browser.cjs')).join('\n'));process.exitCode=1;});
