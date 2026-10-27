'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const core=require('../../frontend/student/js/meet-core');
const directory=path.resolve(__dirname,'../../frontend/student/js');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function listener(){return {items:[],addListener(fn){this.items.push(fn);},emit(...args){for(const fn of this.items)fn(...args);}};}
(async()=>{
  const target='abc-defg-hij';
  assert.equal(core.code('https://meet.google.com/'+target+'?authuser=secret#private'),target);
  assert.equal(core.code('https://meet.google.com/ABC-DEFG-HIJ'),target);
  assert.equal(core.code('https://meet.google.com/landing/'+target),target);
  assert.equal(core.code('https://meet.google.com/lookup/'+target),target);
  assert.equal(core.code('https://meet.google.com/meet/'+target+'?authuser=0#joined'),target);
  assert.equal(core.describe('https://meet.google.com/landing/'+target),'/landing/:code');
  assert.equal(core.describe('https://meet.google.com/meet/'+target),'/meet/:code');
  assert.equal(core.describe('https://meet.google.com/landing'),'/landing');
  for(const url of ['https://meet.google.com.evil.test/'+target,'https://other.test/?https://meet.google.com/'+target,'http://meet.google.com/'+target,'https://meet.google.com/lookup/private','https://user@meet.google.com/'+target])assert.equal(core.code(url),null);
  const designated={id:1,url:'https://meet.google.com/meet/'+target,active:true,windowId:1},wrong={id:2,url:'https://meet.google.com/meet/xyz-abcd-efg',active:true,windowId:2};
  assert.equal(core.observe(target,[wrong],[{id:2,type:'normal',focused:true}]).tabState,'MEET_TAB_NOT_OPEN');
  assert.equal(core.observe(target,[designated,wrong],[{id:2,type:'normal',focused:true}]).tabState,'MEET_TAB_NOT_SELECTED');
  assert.equal(core.observe(target,[designated],[{id:1,type:'normal',focused:true}]).tabState,'MEET_TAB_SELECTED');
  assert.equal(core.observe(target,[],[],true).tabState,'MEET_TAB_CLOSED');
  let now=Date.now(),offline=false,deny=0,queries=0,authChecks=0,sequence=0,consent=false,failPost=false,created=0,activated=0,focusedWindows=0;
  const grantId=crypto.randomUUID(),token=crypto.randomBytes(32).toString('hex'),store={'classence-student-session':{token,expiresAt:new Date(now+900000).toISOString()}},reports=[],alarms=new Map();let tabs=[designated],focused={id:1,type:'normal',focused:true};
  const copy=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
  function boot(){
    const changed=listener(),messages=listener(),alarmEvent=listener();
    const chrome={storage:{local:{setAccessLevel:async options=>assert.equal(options.accessLevel,'TRUSTED_CONTEXTS'),get:async key=>({[key]:copy(store[key])}),set:async data=>{for(const [key,value]of Object.entries(data)){const oldValue=copy(store[key]);store[key]=copy(value);changed.emit({[key]:{oldValue,newValue:copy(value)}},'local');}}},onChanged:changed},
      alarms:{get:async name=>alarms.get(name),create:async(name,v)=>{assert.equal(v.periodInMinutes,.5);alarms.set(name,v);},clear:async name=>alarms.delete(name),onAlarm:alarmEvent},
      tabs:{query:async query=>{assert.deepEqual(copy(query),{url:'https://meet.google.com/*'});queries++;return copy(tabs);},update:async(id,values)=>{assert.equal(id,designated.id);assert.equal(values.active,true);activated++;return copy(designated);},create:async values=>{assert.equal(values.url,'https://meet.google.com/'+target);assert.equal(values.active,true);created++;tabs.push({...designated,id:100+created,active:true});return copy(tabs.at(-1));},onActivated:listener(),onCreated:listener(),onUpdated:listener(),onRemoved:listener(),onReplaced:listener()},windows:{getLastFocused:async query=>{assert.equal(query.populate,false);return copy(focused);},update:async(id,values)=>{assert.equal(id,designated.windowId);assert.equal(values.focused,true);focusedWindows++;return copy(focused);},onFocusChanged:listener()},permissions:{contains:async query=>{assert.deepEqual(copy(query),{origins:['https://meet.google.com/*']});return true;}},runtime:{id:'test-extension',getURL:part=>'chrome-extension://test-extension/'+part,onMessage:messages,onStartup:listener(),onInstalled:listener()}};
    class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
    const context=vm.createContext({chrome,Date:Clock,URL,AbortController,crypto:crypto.webcrypto,setTimeout,clearTimeout,console,fetch:async(url,options)=>{
      assert.equal(options.credentials,'omit');if(!url.endsWith('/refresh'))assert.equal(options.headers.Authorization,'Bearer '+token);if(offline)throw new Error('test unavailable');if(deny)return {ok:false,status:deny,json:async()=>({message:'Authorization ended.'})};
      let data;const body=options.body?JSON.parse(options.body):null;
      if(url.endsWith('/refresh'))return {ok:true,status:200,json:async()=>({data:{accessToken:token,refreshToken:'renewable-test',sessionId:'worker-family',expiresAt:new Date(now+900000).toISOString(),absoluteExpiresAt:new Date(now+14400000).toISOString(),user:{role:'student'}}})};
      if(url.includes('/start')){assert.deepEqual(body,{sessionId:'1',consent:true});consent=true;data={sessionId:'1',meetingCode:target,grantId,sequence,expiresAt:store['classence-student-session'].expiresAt};}
      else if(url.includes('/state?')){authChecks++;data={consent,grantId,sequence,meetingCode:target,lastReportAt:store['classence-meet-monitoring']?.lastReportAt||null};}
      else if(url.endsWith('/stop')){consent=false;data={sessionId:'1'};}
      else {assert.deepEqual(Object.keys(body).sort(),['sessionId','grantId','eventId','sequence','tabState','eventType','observedAt'].sort());if(failPost){failPost=false;throw new Error('test lost delivery');}assert.equal(body.sequence,sequence+1);sequence++;reports.push(body);data={lastReportAt:new Date(now).toISOString(),sequence};}
      return {ok:true,status:200,json:async()=>({success:true,data})};
    }});
    context.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(path.join(directory,file),'utf8'),context,{filename:file}));vm.runInContext(fs.readFileSync(path.join(directory,'background.js'),'utf8'),context,{filename:'background.js'});
    const message=(action,sessionId)=>new Promise(resolve=>messages.items[0]({type:'MEET_MONITOR',action,...(sessionId?{sessionId}:{})},{id:chrome.runtime.id,url:chrome.runtime.getURL('index.html')},resolve));
    const open=url=>new Promise(resolve=>messages.items[0]({type:'OPEN_REGISTERED_MEET',url},{id:chrome.runtime.id,url:chrome.runtime.getURL('index.html')},resolve));
    return {chrome,message,open};
  }
  let worker=boot();await worker.message('VIEW');assert.equal(queries,0);assert.equal(reports.length,0);
  let opened=await worker.open('https://meet.google.com/'+target);assert.equal(opened.ok,true);assert.equal(opened.data.opened,false);assert.equal(activated,1);assert.equal(focusedWindows,1);tabs=[];opened=await worker.open('https://meet.google.com/'+target);assert.equal(opened.ok,true);assert.equal(opened.data.opened,true);assert.equal(created,1);opened=await worker.open('https://example.com/not-a-meeting');assert.equal(opened.ok,false);tabs=[designated];
  let reply=await worker.message('START','1');assert(reply.ok);assert.equal(store['classence-meet-monitoring'].state,'MONITORING');assert.equal(reports[0].tabState,'MEET_TAB_SELECTED');assert(authChecks>0);
  assert(!JSON.stringify(store['classence-meet-monitoring']).includes(token));assert(!JSON.stringify(store['classence-meet-monitoring']).includes('https://'));assert.equal(worker.chrome.runtime.onMessage.items.length,2,'Exactly one monitoring and one authentication listener');assert.equal(worker.chrome.tabs.onCreated.items.length,1,'New Meet tabs trigger a prompt recheck');
  const authListener=worker.chrome.runtime.onMessage.items[1];
  assert.equal(authListener({type:'STUDENT_AUTH',action:'ACCESS'},{id:'untrusted',url:'https://example.com'},()=>assert.fail('Untrusted sender received auth response')),undefined);
  assert.equal(authListener({type:'STUDENT_AUTH',action:'ACCESS'},{id:worker.chrome.runtime.id,url:worker.chrome.runtime.getURL('content.html')},()=>assert.fail('Non-popup context received auth response')),undefined);
  tabs=[{...designated,id:101}];worker.chrome.tabs.onReplaced.emit(101,1);await pause(250);await worker.message('VIEW');assert.equal(reports.length,1);tabs=[];worker.chrome.tabs.onUpdated.emit(101,{},{});await pause(250);await worker.message('VIEW');assert.equal(reports.at(-1).tabState,'MEET_TAB_CLOSED');tabs=[designated];worker.chrome.tabs.onCreated.emit({id:102});await pause(250);await worker.message('VIEW');assert.equal(reports.at(-1).tabState,'MEET_TAB_SELECTED');
  const count=reports.length;worker=boot();await worker.message('VIEW');assert.equal(reports.length,count);assert.equal(worker.chrome.tabs.onActivated.items.length,1);
  tabs=[{...designated,active:false}];failPost=true;worker.chrome.tabs.onActivated.emit({tabId:99});await pause(250);reply=await worker.message('VIEW');assert.equal(store['classence-meet-monitoring'].state,'REPORTING_INTERRUPTED');assert(store['classence-meet-monitoring'].pending);
  const failedId=store['classence-meet-monitoring'].pending.eventId;now+=130000;tabs=[designated];await worker.message('VIEW');assert.notEqual(reports.at(-1).eventId,failedId);assert.equal(reports.at(-1).tabState,'MEET_TAB_SELECTED');
  offline=true;now+=30000;await worker.message('VIEW');assert.equal(store['classence-meet-monitoring'].state,'REPORTING_INTERRUPTED');assert(!Array.isArray(store['classence-meet-monitoring'].pending));
  await worker.message('STOP');assert.equal(store['classence-meet-monitoring'].consent,false);assert(store['classence-meet-monitoring'].pendingStop);const stoppedQueries=queries,stoppedCount=reports.length;
  worker.chrome.tabs.onReplaced.emit(9,8);await pause(250);assert.equal(queries,stoppedQueries);assert.equal(reports.length,stoppedCount);
  offline=false;now+=31000;worker=boot();await worker.message('VIEW');assert.equal(consent,false);assert.equal(store['classence-meet-monitoring'].consent,false);
  if(process.env.CLASSENCE_RECOVERY_EXTENDED==='1'){
    await worker.message('START','1');now+=30000;failPost=true;await worker.message('VIEW');
    const firstPending=copy(store['classence-meet-monitoring'].pending);assert(firstPending.observedAt);assert.equal(Date.parse(firstPending.observedAt),firstPending.createdAt);
    const observedAt=firstPending.observedAt;
    for(let i=0;i<2;i++){now+=121000;failPost=true;await worker.message('VIEW');assert(!Array.isArray(store['classence-meet-monitoring'].pending));}
    assert.equal(store['classence-meet-monitoring'].pending,null);assert.equal(store['classence-meet-monitoring'].retries,3);
    now+=121000;await worker.message('VIEW');assert.notEqual(reports.at(-1).observedAt,observedAt);assert(Date.parse(reports.at(-1).observedAt)>Date.parse(observedAt));
    console.log('PASS RECOVERY WORKER: queue capacity one, original observation timestamp, retry exhaustion, discarded history and fresh re-observation');
    store['classence-student-session']={token,refreshToken:'renewable-test',sessionId:'worker-family',expiresAt:new Date(now+1000).toISOString()};
    offline=true;await worker.message('STOP');assert(store['classence-meet-monitoring'].pendingStop);const stoppedQueryCount=queries;
    const blocked=await worker.message('START','1');assert.equal(blocked.ok,false);assert.equal(queries,stoppedQueryCount);
    now+=61000;offline=false;worker=boot();await worker.message('VIEW');assert.equal(consent,false);assert.equal(store['classence-meet-monitoring'].pendingStop,undefined);assert.equal(queries,stoppedQueryCount);assert(Date.parse(store['classence-student-session'].expiresAt)>now);
    console.log('PASS RECOVERY WORKER: offline withdrawal survives worker restart and access expiry, renews only to revoke, blocks new consent while pending and performs no tab query');
    consent=true;store['classence-meet-monitoring']={sessionId:'1',state:'STARTING',consent:false};store['classence-meet-disabled']=true;worker=boot();await worker.message('VIEW');assert.equal(consent,false);assert.equal(queries,stoppedQueryCount);assert.equal(store['classence-meet-monitoring'].state,'STOPPED');
    console.log('PASS RECOVERY WORKER: a persisted stop intent cancels an interrupted in-flight consent start after worker restart');
    store['classence-student-session']={token,expiresAt:new Date(now+900000).toISOString()};
  }
  await worker.message('START','1');deny=410;await worker.message('VIEW');assert.equal(store['classence-meet-monitoring'].state,'SESSION_ENDED');deny=0;
  await worker.message('START','1');now+=901000;const beforeExpiryQueries=queries;await worker.message('VIEW');assert.equal(store['classence-meet-monitoring'].state,'AUTH_EXPIRED');assert.equal(queries,beforeExpiryQueries);
  console.log('PASS unit/worker VM: exact matching, focus/multiple tabs, no queries without consent, trusted-only state, minimal payload, worker recovery/no duplicate listeners, bounded pending retry, stale observation discarded, outage/withdrawal recovery, session end and expiry without further tab queries.');
})().catch(e=>{console.error(e);process.exitCode=1;});
