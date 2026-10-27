'use strict';
require('dotenv').config({path:require('node:path').join(__dirname,'..','.env'),quiet:true});
const assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path'),fs=require('node:fs');
const pool=require('../src/config/database'),{setup}=require('../src/index'),chromePipe=require('./chrome-pipe.cjs');
const uidForProfile=()=>crypto.randomUUID();
(async()=>{
  const db=await pool.getConnection();let chrome,api,page;
  try{
    const before={};for(const table of ['users','faculty_profiles','student_profiles','auth_sessions']){const [[r]]=await db.query('SELECT COUNT(*) AS count FROM `'+table+'`');before[table]=r.count;}
    await db.beginTransaction();
    const testPool={execute:(...args)=>db.execute(...args),query:(...args)=>db.query(...args),getConnection:async()=>({execute:(...args)=>db.execute(...args),beginTransaction:()=>db.query('SAVEPOINT student_registration'),commit:()=>db.query('RELEASE SAVEPOINT student_registration'),rollback:()=>db.query('ROLLBACK TO SAVEPOINT student_registration'),release(){}})};
    const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../../frontend/student/manifest.json'),'utf8'));assert.equal(manifest.manifest_version,3);assert.deepEqual(manifest.permissions,['storage','alarms']);assert.equal(manifest.background.service_worker,'js/background.js');assert(!manifest.content_scripts);
    const id=[...crypto.createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32)].map(x=>String.fromCharCode(97+parseInt(x,16))).join('');
    process.env.CLIENT_ORIGIN='chrome-extension://'+id;process.env.AUTH_LOGIN_LIMIT='100';process.env.AUTH_REGISTER_LIMIT='100';
    api=setup({pool:testPool}).app.listen(0,'127.0.0.1');await new Promise(r=>api.once('listening',r));const base='http://127.0.0.1:'+api.address().port;
    const profilePath=path.join(require('node:os').tmpdir(),'classence-persistence-'+uidForProfile());
    const extensionPath=path.join(profilePath,'test-extension');fs.mkdirSync(extensionPath,{recursive:true});fs.cpSync(path.resolve(__dirname,'../../frontend/student'),extensionPath,{recursive:true});const testIndex=path.join(extensionPath,'index.html');fs.writeFileSync(testIndex,fs.readFileSync(testIndex,'utf8').replace('content="http://127.0.0.1:3000"','content="'+base+'"'));
    fs.writeFileSync(path.join(extensionPath,'js/monitoring-config.js'),'globalThis.CLASSENCE_MONITORING_API='+JSON.stringify(base)+';');
    chrome=await chromePipe(profilePath);console.log("Chrome pipe ready");const loaded=await chrome.send('Extensions.loadUnpacked',{path:extensionPath});assert.equal(loaded.id,id);console.log("Unpacked extension loaded");
    const url='chrome-extension://'+id+'/index.html';page=await chrome.open(url,base);console.log("Extension document opened");assert.equal(await page.evaluate('chrome.runtime.id'),id);
    await page.evaluate('localStorage.setItem("classwatch-demo-v2","preserved original records");localStorage.setItem("cw-student","fake-local-user");render()');assert(await page.evaluate('!!document.querySelector("[data-form=login]")'));
    const uid=crypto.randomUUID(),password='StudentIntegration123!',email='student-'+uid+'@example.edu';
    const fill=async(extra={})=>{for(const [key,value]of Object.entries({studentId:'00-'+uid,name:'Student Integration',program:'BSIT',yearLevel:'4',section:'BSIT 3-1',email,password,confirm:password,...extra}))await page.input('#'+key,value);await page.evaluate('document.querySelector("#agreement").checked=true');};
    const submit=async()=>{await page.wait('!authBusy');await page.evaluate('document.querySelector("[data-form]").requestSubmit()');};
    await page.click('[data-action=auth-mode]');await submit();assert.equal(await page.evaluate('document.activeElement.id'),'studentId');
    await fill({confirm:'mismatch'});await submit();assert(await page.evaluate('document.querySelector("#confirm-error").textContent.includes("match")'));
    await fill();await page.evaluate('document.querySelector("#agreement").checked=false');await submit();assert(await page.evaluate('document.querySelector("#agreement-error").textContent.includes("accept")'));
    await fill({yearLevel:'5'});await submit();assert(await page.evaluate('document.querySelector("#yearLevel-error").textContent.includes("valid")'));
    await fill();await submit();await page.wait('!!document.querySelector("[data-form=login]")');assert(await page.evaluate('!StudentAPI.current'));
    const [[user]]=await db.execute('SELECT u.id,s.student_id,s.year_level FROM users u JOIN student_profiles s ON s.user_id=u.id WHERE u.email=?',[email]);assert.equal(user.student_id,'00-'+uid);assert.equal(user.year_level,4);
    await page.click('[data-action=auth-mode]');await fill({studentId:'different-'+uid});await submit();await page.wait('document.querySelector("#feedback")?.textContent.includes("already registered")');
    await fill({email:'duplicate-'+uid+'@example.edu'});await submit();await page.wait('document.querySelector("#feedback")?.textContent.includes("already registered")');
    await page.click('[data-action=auth-mode]');await page.input('#email',email);await page.input('#password','incorrect');await submit();await page.wait('document.querySelector("#feedback")?.textContent.includes("Invalid")');
    await page.input('#email','unknown-'+uid+'@example.edu');await submit();await page.wait('document.querySelector("#feedback")?.textContent.includes("Invalid")');
    await page.input('#email',email);await page.input('#password',password);await submit();await page.wait('document.querySelector("h1")?.textContent==="Hello, Student"');assert.equal(await page.evaluate('enrolled().length'),0);
    await page.click('[data-page=profile]');await page.wait('document.querySelector("h1")?.textContent==="My Profile"');assert(await page.evaluate('document.querySelector(".profile-details").textContent.includes("00-'+uid+'")'));
    assert(await page.evaluate('![...Object.values(localStorage),...Object.values(sessionStorage)].some(value=>value.includes("'+password+'"))'));
    await page.click('[data-page=home]');assert.equal(await page.evaluate('!!document.querySelector("[data-action=load-samples]")'),false);assert.equal(await page.evaluate('enrolled().length'),0);
    await page.click('[data-page=classes]');await page.wait('!!document.querySelector("#search")');await page.input('#search','Database');await page.evaluate('document.querySelector("#search").dispatchEvent(new Event("input",{bubbles:true}))');assert.equal(await page.evaluate('document.querySelectorAll(".class-list .card").length'),0);

    for(const width of [400]){await page.command('Emulation.setDeviceMetricsOverride',{width,height:600,deviceScaleFactor:1,mobile:false});for(const view of ['home','classes','enroll','session','profile']){await page.evaluate(`state.page='${view}';state.classId='c1';render()`);assert(await page.evaluate('document.documentElement.scrollWidth<=innerWidth'));assert(await page.evaluate('document.querySelector(".popup-nav").getBoundingClientRect().bottom<=innerHeight'));}}
    await page.click('[data-page=profile]');await page.wait('!!document.querySelector("[data-action=logout]")');
    await page.click('[data-action=logout]');await page.wait('document.querySelector("#confirmation").open');await page.click('[data-confirm]');await page.wait('!!document.querySelector("[data-form=login]")');
    const [[revoked]]=await db.execute('SELECT COUNT(*) AS count FROM auth_sessions WHERE user_id=? AND revoked_at IS NOT NULL',[user.id]);assert(revoked.count>0);
    const facultyEmail='faculty-'+uid+'@example.edu';await fetch(base+'/api/auth/faculty/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({facultyId:'FAC-'+uid,fullName:'Integration Faculty',department:'Department',academicPosition:'Professor',email:facultyEmail,password})});
    await page.input('#email',facultyEmail);await page.input('#password',password);await submit();await page.wait('document.querySelector("#feedback")?.textContent.includes("Student account")');
    await page.input('#email',email);await page.input('#password',password);await submit();await page.wait('!!StudentAPI.current');
    await db.execute('UPDATE session_families SET absolute_expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE user_id=? AND revoked_at IS NULL',[user.id]);await page.click('[data-page=profile]');await page.wait('!!document.querySelector("[data-form=login]")');
    await page.input('#email',email);await page.input('#password',password);await submit();await page.wait('!!StudentAPI.current');
    await page.close();page=await chrome.open(url,base);assert.equal(await page.evaluate('StudentAPI.current.email'),email);assert(await page.evaluate('localStorage.getItem("classwatch-demo-v2")==="preserved original records"'));
    await page.command('Emulation.clearDeviceMetricsOverride');
    const popupOpened=await page.evaluate('chrome.action.openPopup().then(()=>true).catch(()=>false)');
    if(popupOpened){
      const targets=await chrome.send('Target.getTargets'),target=targets.targetInfos.find(t=>t.url===url&&t.targetId!==page.targetId);
      assert(target,'Toolbar popup target must exist');
      let popup=await chrome.open(url,base,target.targetId);assert.equal(await popup.evaluate('StudentAPI.current.email'),email);
      await popup.click('[data-page=profile]');await popup.wait('document.querySelector("h1")?.textContent==="My Profile"');
      console.log(await popup.evaluate('({height:innerHeight,width:innerWidth,bottom:document.querySelector(".popup-nav").getBoundingClientRect().bottom,popupHeight:document.querySelector(".popup").getBoundingClientRect().height})'));assert(await popup.evaluate('document.querySelector(".popup-nav").getBoundingClientRect().bottom<=innerHeight'));
      await popup.close();await page.command('Page.bringToFront');await new Promise(r=>setTimeout(r,300));await page.evaluate('chrome.action.openPopup()');
      const reopenedTargets=await chrome.send('Target.getTargets'),reopened=reopenedTargets.targetInfos.find(t=>t.url===url&&t.targetId!==page.targetId);
      assert(reopened);popup=await chrome.open(url,base,reopened.targetId);assert.equal(await popup.evaluate('StudentAPI.current.email'),email);await popup.close();
      console.log('PASS: actual toolbar popup login/profile/bottom navigation and close/reopen persistent session.');
    }else console.log('SKIPPED: toolbar popup automation unavailable; extension document lifecycle tested.');

    await chrome.close();await new Promise(r=>setTimeout(r,500));chrome=await chromePipe(profilePath);
    await chrome.send('Extensions.loadUnpacked',{path:extensionPath});
    page=await chrome.open(url,base);assert.equal(await page.evaluate('StudentAPI.current.email'),email);
    console.log('PASS: full Chrome restart restores the same Student session.');
    await db.execute('UPDATE auth_sessions SET revoked_at=UTC_TIMESTAMP(3) WHERE user_id=? AND revoked_at IS NULL',[user.id]);
    await page.close();page=await chrome.open(url,base);assert(await page.evaluate('!StudentAPI.current && !!document.querySelector("[data-form=login]")'));
    await page.input('#email',email);await page.input('#password',password);await submit();await page.wait('!!StudentAPI.current');
    await new Promise(r=>{api.close(r);api.closeAllConnections();});api=null;
    await page.close();page=await chrome.open(url,base);
    assert(await page.evaluate('!StudentAPI.current && document.querySelector("#feedback").textContent.includes("Cannot connect")'));
    assert(await page.evaluate('chrome.storage.local.get("classence-student-session").then(data=>!!data["classence-student-session"])'));

    api=setup({pool:testPool}).app.listen(Number(new URL(base).port),'127.0.0.1');await new Promise(r=>api.once('listening',r));
    await page.close();page=await chrome.open(url,base);assert.equal(await page.evaluate('StudentAPI.current.email'),email);
    await page.click('[data-page=profile]');await page.wait('!!document.querySelector("[data-action=logout]")');
    await page.click('[data-action=logout]');await page.wait('document.querySelector("#confirmation").open');await page.click('[data-confirm]');await page.wait('!!document.querySelector("[data-form=login]")');
    await page.close();page=await chrome.open(url,base);assert(await page.evaluate('!StudentAPI.current && !!document.querySelector("[data-form=login]")'));
    assert(await page.evaluate('chrome.storage.local.get("classence-student-session").then(data=>!data["classence-student-session"])'));
    const errors=chrome.events.filter(e=>e.method==='Runtime.exceptionThrown'||e.method==='Log.entryAdded'&&/Content Security Policy|CORS policy|Cross-Origin Request Blocked/i.test(e.params.entry.text));assert.equal(errors.length,0);
    console.log('PASS: actual unpacked MV3 extension ID/CSP context, real MySQL registration, validation/duplicates/agreement, login/role rejection, profile, logout/expiry, popup-document persistence, browser restart, revocation and outage recovery, prototype records and responsive bottom navigation.');
    await db.rollback();for(const table of Object.keys(before)){const [[r]]=await db.query('SELECT COUNT(*) AS count FROM `'+table+'`');assert.equal(r.count,before[table]);}console.log('PASS: database fixture rollback and original prototype data preservation.');
  }finally{if(chrome)await chrome.close();if(api)await new Promise(r=>{api.close(r);api.closeAllConnections();});await db.rollback();db.release();await pool.end();}
})().catch(error=>{console.error('Student integration failed:',error.code||error.message);if(error.code==='ERR_ASSERTION')console.error(error.stack.split('\n').filter(line=>line.includes('student-integration.cjs')).join('\n'));process.exitCode=1;});
