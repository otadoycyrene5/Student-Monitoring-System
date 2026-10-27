'use strict';
const assert=require('node:assert/strict');
exports.faculty=async({chrome,page,db,origin,base,user})=>{
 const viewport=await page.evaluate('({width:innerWidth,height:innerHeight})');await page.command('Emulation.setDeviceMetricsOverride',{width:viewport.width,height:400,deviceScaleFactor:1,mobile:false});await page.evaluate('window.scrollTo(0,120);window.__renewalDOM={app:document.querySelector(".app"),view:document.querySelector("#view"),scroll:scrollY,document:window.__testDocument}');
 const second=await chrome.open(origin+'/teacher/',base);await second.wait('!!FacultyAPI.current');
 const [[before]]=await db.execute("SELECT COUNT(*) n FROM session_security_events e JOIN session_families f ON f.id=e.family_id WHERE f.user_id=? AND event_type='Renewed'",[user.id]);
 await db.execute('UPDATE auth_sessions SET expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE user_id=? AND revoked_at IS NULL',[user.id]);
 await Promise.all([page.evaluate('FacultyAPI.renew()'),second.evaluate('FacultyAPI.renew()')]);
 const [[after]]=await db.execute("SELECT COUNT(*) n FROM session_security_events e JOIN session_families f ON f.id=e.family_id WHERE f.user_id=? AND event_type='Renewed'",[user.id]);assert.equal(after.n,before.n+1);assert.equal(await second.evaluate('FacultyAPI.current.email'),user.email);
 await second.close();await page.wait('ClassenceRealtime.state.connection==="CONNECTED"');
 assert(await page.evaluate('document.querySelector(".app")===window.__renewalDOM.app && document.querySelector("#view")===window.__renewalDOM.view && window.__testDocument===window.__renewalDOM.document && Math.abs(scrollY-window.__renewalDOM.scroll)<2'),'Renewal preserves the existing Faculty document, shell, view and scroll');
 await page.command('Emulation.setDeviceMetricsOverride',{...viewport,deviceScaleFactor:1,mobile:false});
 console.log('PASS RENEWAL CHROME: Faculty two-tab simultaneous expiry recovery uses one rotation; real class edit and attendance save continue below.');
};
exports.student=async({db,ctl,wait,users,activeSession,popup})=>{
 const [[before]]=await db.execute('SELECT grant_id,last_sequence FROM meet_monitoring WHERE session_id=?',[activeSession.id]);
 await db.execute('UPDATE auth_sessions SET expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE user_id=? AND revoked_at IS NULL',[users[1].id]);

 await ctl('chrome.tabs.create({url:"about:blank",active:true})');
 await wait(async()=>{const [[r]]=await db.execute('SELECT last_sequence FROM meet_monitoring WHERE session_id=?',[activeSession.id]);return r.last_sequence>before.last_sequence;});
 const [[after]]=await db.execute('SELECT grant_id,consent_active FROM meet_monitoring WHERE session_id=?',[activeSession.id]);assert.equal(after.grant_id,before.grant_id);assert.equal(after.consent_active,1);
 const actual=await popup();await actual.wait('!!StudentAPI.current');await ctl('chrome.storage.local.get("classence-student-session").then(d=>chrome.storage.local.set({"classence-student-session":{...d["classence-student-session"],expiresAt:new Date(Date.now()-1000).toISOString()}}))');await actual.evaluate('Promise.all([StudentAPI.renew(),chrome.runtime.sendMessage({type:"MEET_MONITOR",action:"VIEW"})]).then(()=>true)');assert.equal(await actual.evaluate('StudentAPI.current.email'),users[1].email);await actual.close();
 const [[a]]=await db.execute('SELECT status FROM attendance WHERE session_id=?',[activeSession.id]);assert.equal(a.status,'Present');

 await ctl('chrome.tabs.query({url:"https://meet.google.com/abc-defg-hij"}).then(t=>chrome.tabs.update(t[0].id,{active:true}))');
 await wait(async()=>{const [[r]]=await db.execute('SELECT tab_state FROM meet_monitoring WHERE session_id=?',[activeSession.id]);return r.tab_state==='MEET_TAB_SELECTED';});
 console.log('PASS RENEWAL CHROME: actual popup-closed worker refresh after access expiry preserves original consent and automatic attendance.');
};

exports.account=async({browser,extensionOrigin,base,users,password})=>{
 const first=await browser.open(extensionOrigin+'/index.html',base);assert.equal(await first.evaluate('StudentAPI.current.email'),users[1].email);
 const second=await browser.open(extensionOrigin+'/index.html',base);
 await second.evaluate('StudentAPI.login('+JSON.stringify(users[2].email)+','+JSON.stringify(password)+').then(()=>render())');
 await first.wait('!StudentAPI.current && !!document.querySelector("[data-form=login]")');assert.equal(await second.evaluate('StudentAPI.current.email'),users[2].email);
 assert(!(await first.evaluate('document.querySelector("#view")?.textContent||""')).includes(users[1].email));
 await second.evaluate('StudentAPI.logout()');await first.close();await second.close();
 console.log('PASS RENEWAL CHROME: switching Student accounts clears the other trusted view before exposing a different profile.');
};
