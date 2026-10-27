'use strict';
const assert=require('node:assert/strict');
module.exports=async({teacher,browser,ctl,db,realtime,users,activeSession,realClass,wait,extensionOrigin})=>{
 const conditions=offline=>({offline,latency:0,downloadThroughput:-1,uploadThroughput:-1});
 await teacher.command('Network.emulateNetworkConditions',conditions(true));
 for(const socket of realtime.io.sockets.sockets.values())if(String(socket.data.identity.userId)===String(users[0].id))socket.disconnect(true);
 await teacher.wait('ClassenceRealtime.state.connection!=="CONNECTED"');
 await teacher.wait('document.querySelector("[data-meet-health]")?.dataset.meetState==="MEET_TAB_STATE_UNKNOWN"');
 await teacher.command('Network.emulateNetworkConditions',conditions(false));await teacher.evaluate('window.dispatchEvent(new Event("online"))');
 await teacher.wait('ClassenceRealtime.state.connection==="CONNECTED"');
 assert.equal(await teacher.evaluate('document.querySelectorAll(".historical-monitor tbody tr").length'),1);
 console.log('PASS RECOVERY CHROME: Faculty CDP offline/disconnected masks old health; online reauthorizes rooms and reloads one authoritative roster');
 const worker=(await browser.send('Target.getTargets')).targetInfos.find(t=>t.type==='service_worker'&&t.url===extensionOrigin+'/js/background.js');assert(worker);
 const {sessionId}=await browser.send('Target.attachToTarget',{targetId:worker.targetId,flatten:true});
 await browser.send('Fetch.enable',{patterns:[{urlPattern:'http://127.0.0.1:*/api/auth/*',requestStage:'Request'}]},sessionId);
 let cursor=browser.events.length;const failures=new Set();const pump=setInterval(()=>{for(const event of browser.events.slice(cursor)){if(event.sessionId===sessionId&&event.method==='Fetch.requestPaused'&&!failures.has(event.params.requestId)){failures.add(event.params.requestId);browser.send('Fetch.failRequest',{requestId:event.params.requestId,errorReason:'InternetDisconnected'},sessionId).catch(()=>{});}}cursor=browser.events.length;},20);
 try{
 const [[before]]=await db.execute('SELECT grant_id,last_sequence FROM meet_monitoring WHERE session_id=?',[activeSession.id]);
 await ctl('chrome.tabs.create({url:"about:blank",active:true})');
 await wait(()=>ctl('chrome.storage.local.get("classence-meet-monitoring").then(v=>v["classence-meet-monitoring"]?.state==="REPORTING_INTERRUPTED")'));
 console.log('Recovery Chrome checkpoint: worker request failed as expected');
 const [[during]]=await db.execute('SELECT last_sequence FROM meet_monitoring WHERE session_id=?',[activeSession.id]);assert.equal(during.last_sequence,before.last_sequence);
 await db.execute('UPDATE meet_monitoring SET last_report_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 76 SECOND) WHERE session_id=?',[activeSession.id]);
 await realtime.notifyMonitoring({classId:String(realClass.id),sessionId:String(activeSession.id)});
 await teacher.wait('document.querySelector("[data-meet-health]")?.dataset.meetState==="MEET_TAB_STATE_UNKNOWN"');
 clearInterval(pump);await browser.send('Fetch.disable',{},sessionId);

 await ctl('chrome.storage.local.get("classence-meet-monitoring").then(v=>chrome.storage.local.set({"classence-meet-monitoring":{...v["classence-meet-monitoring"],retryAt:0}}))');
 await ctl('chrome.tabs.create({url:"about:blank",active:true})');
 await wait(async()=>{const [[row]]=await db.execute('SELECT grant_id,last_sequence FROM meet_monitoring WHERE session_id=?',[activeSession.id]);assert.equal(row.grant_id,before.grant_id);return row.last_sequence>before.last_sequence;});
 await teacher.wait('document.querySelector("[data-meet-health]")?.dataset.meetState!=="MEET_TAB_STATE_UNKNOWN"');
 }finally{clearInterval(pump);await browser.send('Fetch.disable',{},sessionId).catch(()=>{});await browser.send('Target.detachFromTarget',{sessionId}).catch(()=>{});}
 console.log('PASS RECOVERY CHROME: actual worker CDP request outage persists no reports; accelerated stale/retry deadlines, consent revalidation and fresh reporting recovery preserve original grant');
};
