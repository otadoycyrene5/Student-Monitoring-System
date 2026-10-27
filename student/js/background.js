
'use strict';
importScripts('meet-core.js','monitoring-config.js');
const STORE='classence-meet-monitoring',AUTH='classence-student-session',ALARM='classence-meet-reconcile',DISABLED='classence-meet-disabled',CONSENT='classence-meet-consent-preference';
const ready=chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
let tail=Promise.resolve(),timer=null,epoch=0,halted=false,controller=null,scheduled=false,scheduledDirty=false;
const enqueue=work=>{const next=tail.then(work);tail=next.catch(()=>{});return next;};
const read=async key=>{await ready;return (await chrome.storage.local.get(key))[key];};
const save=async record=>{await ready;await chrome.storage.local.set({[STORE]:record});};
async function alarm(){if(!await chrome.alarms.get(ALARM))await chrome.alarms.create(ALARM,{periodInMinutes:.5});}
async function rawRequest(path,body,auth){controller=new AbortController();const active=controller,timeout=setTimeout(()=>active.abort(),8000);try{const response=await fetch(CLASSENCE_MONITORING_API+'/api/auth/monitoring/'+path,{method:body?'POST':'GET',credentials:'omit',signal:active.signal,headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.token},...(body?{body:JSON.stringify(body)}:{})});const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.message||'Monitoring request rejected.'),{status:response.status});return result.data;}finally{clearTimeout(timeout);if(controller===active)controller=null;}}
async function request(path,body,auth){if(auth?.refreshToken)auth=await StudentAuthCoordinator.ensure();try{return await rawRequest(path,body,auth);}catch(error){if(error.status===401&&auth?.refreshToken)return rawRequest(path,body,await StudentAuthCoordinator.ensure(true));throw error;}}
async function localStop(record,state){epoch++;halted=true;controller?.abort();await chrome.alarms.clear(ALARM);const stopped={sessionId:record?.sessionId||null,state,consent:false,lastReportAt:record?.lastReportAt||null,tabState:'MEET_TAB_STATE_UNKNOWN',unfocusedSince:null};await save(stopped);return stopped;}
async function tick(reason='RECONCILED'){
  const record=await read(STORE);if(!record?.consent||halted||await read(DISABLED))return;
  await alarm();
  const version=epoch;let auth=await read(AUTH);
  if(auth?.refreshToken){try{auth=await StudentAuthCoordinator.ensure();}catch(error){if([401,403].includes(error.status))await localStop(record,'AUTH_EXPIRED');else{record.state='REPORTING_INTERRUPTED';await save(record);}return;}}
  if(auth?.pendingLogout||!auth?.token||Date.parse(auth.expiresAt)<=Date.now()){await localStop(record,'AUTH_EXPIRED');return;}
  await alarm();if(record.retryAt>Date.now())return;
  try{

    const current=await request('state?sessionId='+encodeURIComponent(record.sessionId),null,auth);
    if(version!==epoch||halted)return;
    if(!current.consent||current.grantId!==record.grantId){await localStop(record,'STOPPED');return;}
    if(current.meetingCode!==record.meetingCode){await localStop(record,'STOPPED');return;}
    const tabs=await chrome.tabs.query({url:'https://meet.google.com/*'});
    const windows=[await chrome.windows.getLastFocused({windowTypes:['normal'],populate:false})];
    if(version!==epoch||halted)return;
    const observation=MeetCore.observe(current.meetingCode,tabs,windows,record.seen);
    if(observation.tabState===record.tabState&&Date.now()-Date.parse(current.lastReportAt||0)<20000&&current.lastReportAt===record.lastReportAt&&!record.pending){record.state='MONITORING';record.retryAt=0;await save(record);return;}

    const pending=record.pending&&Date.now()-record.pending.createdAt<15000&&record.pending.tabState===observation.tabState?record.pending:{sessionId:record.sessionId,grantId:record.grantId,eventId:crypto.randomUUID(),sequence:current.sequence+1,tabState:observation.tabState,eventType:reason==='TAB_STATE'?'TAB_STATE':'RECONCILED',observedAt:new Date().toISOString(),createdAt:Date.now()};
    const keepUnfocusedSince=observation.tabState==='MEET_TAB_NOT_SELECTED'&&record.tabState==='MEET_TAB_NOT_SELECTED'&&record.unfocusedSince&&record.lastReportAt&&Date.now()-Date.parse(record.lastReportAt)<=75000;
    record.pending=pending;record.seen=observation.seen;record.tabState=observation.tabState;record.unfocusedSince=observation.tabState==='MEET_TAB_NOT_SELECTED'?(keepUnfocusedSince?record.unfocusedSince:pending.observedAt):null;await save(record);
    if(version!==epoch||halted)return;
    const {createdAt,...payload}=pending,result=await request('event',payload,auth);
    if(version!==epoch||halted)return;
    record.pending=null;record.state=result.delayed?'STATUS_UNKNOWN':'MONITORING';record.lastObservedAt=pending.observedAt;record.lastReportAt=result.lastReportAt;record.retries=0;record.retryAt=0;await save(record);
  }catch(error){if(version!==epoch||halted)return;
    if([401,403,404,410].includes(error.status)){await localStop(record,error.status===401?'AUTH_EXPIRED':error.status===410?'SESSION_ENDED':'STOPPED');return;}
    record.state='REPORTING_INTERRUPTED';record.retries=(record.retries||0)+1;record.retryAt=Date.now()+Math.min(120000,30000*2**Math.min(record.retries-1,2));
    if(record.retries>=3||error.status===409)record.pending=null;
    await save(record);
  }
}
function schedule(){if(scheduled){scheduledDirty=true;return;}if(timer)return;timer=setTimeout(()=>{timer=null;scheduled=true;enqueue(()=>tick('TAB_STATE')).catch(()=>{}).finally(()=>{scheduled=false;if(scheduledDirty){scheduledDirty=false;schedule();}});},200);}
async function stop(withdraw=false){
  const record=await read(STORE),auth=await read(AUTH);
  if(withdraw)await chrome.storage.local.set({[DISABLED]:true});await localStop(record,'STOPPED');
  if(record?.sessionId&&auth?.token){await save({sessionId:record.sessionId,state:'STOPPED',consent:false,pendingStop:true,authSessionId:auth.sessionId||null,lastReportAt:record.lastReportAt||null});await alarm();await recover();}
}
async function startMonitoring(sessionId){
  if((await read(STORE))?.pendingStop){await recover();if((await read(STORE))?.pendingStop)throw new Error('Withdrawal is pending. Reconnect before starting monitoring again.');}
  if(typeof sessionId!=='string'||!/^[1-9][0-9]{0,18}$/.test(sessionId))throw new Error('Invalid session.');
  let auth=await read(AUTH);if(auth?.refreshToken)auth=await StudentAuthCoordinator.ensure();if(!auth?.token||Date.parse(auth.expiresAt)<=Date.now())throw new Error('Please sign in again.');
  const started=epoch;await save({sessionId,state:'STARTING',consent:false});
  const grant=await request('start',{sessionId,consent:true},auth);
  if(started!==epoch)throw new Error('Monitoring start cancelled.');
  epoch++;halted=false;await chrome.storage.local.set({[DISABLED]:false});await save({...grant,consent:true,state:'STARTING',tabState:'MEET_TAB_STATE_UNKNOWN',unfocusedSince:null,seen:false});await alarm();await tick();
}
async function recover(){
  const record=await read(STORE);
  if(await read(DISABLED)&&(record?.consent||record?.state==='STARTING')){await stop();return;}
  if(record?.pendingStop){
    await alarm();
    let auth=await read(AUTH);
    if(!auth?.token||auth.pendingLogout||record.authSessionId&&record.authSessionId!==auth.sessionId){await localStop(record,'AUTH_EXPIRED');return;}
    if(record.retryAt>Date.now())return;
    try{
      if(auth.refreshToken)auth=await StudentAuthCoordinator.ensure();
      if(Date.parse(auth.expiresAt)<=Date.now()){await localStop(record,'AUTH_EXPIRED');return;}
      await request('stop',{sessionId:record.sessionId},auth);await localStop(record,'STOPPED');
    }catch(error){
      if([401,403,404,410].includes(error.status))await localStop(record,error.status===401?'AUTH_EXPIRED':'STOPPED');
      else{record.retryAt=Date.now()+Math.min(120000,30000*2**Math.min(record.retries||0,2));record.retries=(record.retries||0)+1;await save(record);await alarm();}
    }return;
  }
  await tick();
}
async function openRegisteredMeet(url){
  const meetingCode=MeetCore.code(url);
  if(!meetingCode)throw new Error('This class does not have a valid registered Google Meet link.');
  const tabs=await chrome.tabs.query({url:'https://meet.google.com/*'}),existing=tabs.find(tab=>MeetCore.code(tab.url)===meetingCode);
  if(existing){
    await chrome.windows.update(existing.windowId,{focused:true});
    await chrome.tabs.update(existing.id,{active:true});
    return {opened:false};
  }
  await chrome.tabs.create({url,active:true});
  return {opened:true};
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(message?.type==='OPEN_REGISTERED_MEET'){
    if(sender.id!==chrome.runtime.id||sender.url!==chrome.runtime.getURL('index.html')||Object.keys(message).some(key=>!['type','url'].includes(key))||typeof message.url!=='string'){reply({ok:false,message:'Invalid meeting request.'});return;}
    enqueue(()=>openRegisteredMeet(message.url)).then(data=>reply({ok:true,data})).catch(error=>reply({ok:false,message:error.message||'Cannot open the registered Google Meet.'}));
    return true;
  }
  if(sender.id!==chrome.runtime.id||sender.url!==chrome.runtime.getURL('index.html')||message?.type!=='MEET_MONITOR')return;
  if(!['VIEW','START','STOP','END_SESSION','AUTO_START','ENABLE','WITHDRAW'].includes(message.action)||Object.keys(message).some(k=>!['type','action','sessionId','email'].includes(k))){reply({ok:false,message:'Invalid monitoring request.'});return;}
  if(['STOP','WITHDRAW','END_SESSION'].includes(message.action)){halted=true;epoch++;controller?.abort();if(['STOP','WITHDRAW'].includes(message.action))chrome.storage.local.set({[DISABLED]:true}).catch(()=>{});}
  enqueue(async()=>{
    if(message.action==='STOP')await stop(true);
    if(message.action==='WITHDRAW'){await chrome.storage.local.remove(CONSENT);await stop(true);}
    if(message.action==='END_SESSION')await stop(false);
    if(message.action==='ENABLE'){if(typeof message.email!=='string'||!/^\S+@\S+\.\S+$/.test(message.email))throw new Error('Invalid monitoring preference.');await chrome.storage.local.set({[CONSENT]:{email:message.email.trim().toLowerCase(),grantedAt:new Date().toISOString()},[DISABLED]:false});}
    if(message.action==='START')await startMonitoring(message.sessionId);
    if(message.action==='AUTO_START'){const preference=await read(CONSENT);if(preference?.email&&preference.email===String(message.email||'').trim().toLowerCase()&&!await read(DISABLED))await startMonitoring(message.sessionId);}
    if(message.action==='VIEW')await recover();
    const value=await read(STORE);
    reply({ok:true,data:value?{sessionId:value.sessionId,state:value.state,consent:!!value.consent,meetingCode:value.meetingCode||null,tabState:value.tabState,lastReportAt:value.lastReportAt||null,unfocusedSince:value.unfocusedSince||null,pendingStop:!!value.pendingStop,lastObservedAt:value.lastObservedAt||null}:null});
  }).catch(()=>reply({ok:false,message:'Cannot update monitoring. Verify your session and backend connection.'}));return true;
});

chrome.tabs.onActivated.addListener(schedule);
chrome.tabs.onCreated.addListener(schedule);
chrome.tabs.onUpdated.addListener(schedule);
chrome.tabs.onRemoved.addListener(schedule);
chrome.tabs.onReplaced.addListener(schedule);
chrome.windows.onFocusChanged.addListener(schedule);
chrome.alarms.onAlarm.addListener(value=>{if(value.name===ALARM)enqueue(recover);});
chrome.runtime.onStartup.addListener(()=>enqueue(recover));
chrome.runtime.onInstalled.addListener(()=>enqueue(recover));
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes[AUTH]&&changes[AUTH].oldValue?.token!==changes[AUTH].newValue?.token&&(!changes[AUTH].newValue?.sessionId||changes[AUTH].oldValue?.sessionId!==changes[AUTH].newValue?.sessionId)){halted=true;epoch++;controller?.abort();enqueue(async()=>{const record=await read(STORE);if(record?.consent)await localStop(record,'AUTH_EXPIRED');});}});


importScripts('auth-coordinator.js');


enqueue(recover).catch(()=>{});
