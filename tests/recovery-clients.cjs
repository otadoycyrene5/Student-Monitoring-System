'use strict';

const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const pause=()=>new Promise(r=>setImmediate(r));
const root=path.resolve(__dirname,'../../frontend');
function emitter(){const callbacks={};return {on(name,fn){(callbacks[name]||=[]).push(fn);return this;},fire(name,...args){for(const fn of callbacks[name]||[])fn(...args);}};}
(async()=>{
 for(const role of ['teacher','student']){
  const socket=emitter(),manager=emitter(),listeners={},pending=[],timers=[],intervals=[];let renewFail=false,renewals=0;
  Object.assign(socket,{io:manager,connected:false,connect(){if(this.connected)return;this.connected=true;this.fire('connect');},disconnect(){if(this.connected){this.connected=false;this.fire('disconnect','io client disconnect');}},timeout(){return this;},emit(name,value,ack){pending.push({name,value,ack});}});
  const api={current:{id:'1'},renew:async()=>{renewals++;if(renewFail)throw new Error('Offline');},invalidateSession(){this.current=null;},socketAuth(callback){callback({token:'test'});}};
  const document={querySelector:()=>null,getElementById:()=>null,addEventListener(){}};
  const context=vm.createContext({window:{[role==='teacher'?'FacultyAPI':'StudentAPI']:api,addEventListener:(name,fn)=>listeners[name]=fn,dispatchEvent(){}},[role==='teacher'?'FacultyAPI':'StudentAPI']:api,document,UI:{escape:String},io:()=>socket,queueMicrotask,Date,Event:class{},setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout(){},setInterval:(fn,ms)=>intervals.push({fn,ms})});
  vm.runInContext(fs.readFileSync(path.join(root,role,'js/realtime.js'),'utf8'),context);
  const app=context.window.ClassenceRealtime;app.ensure();assert.equal(pending[0].name,'realtime:sync');
  const older=pending.shift();socket.disconnect();socket.connect();const newer=pending.shift();newer.ack(null,{ok:true,data:{classes:[],serverTime:'new'}});await pause();while(pending.length){pending.shift().ack(null,{ok:true,data:{classes:[],serverTime:'new'}});await pause();}
  older.ack(null,{ok:true,data:{classes:[],serverTime:'old'}});await pause();

  assert.equal(app.state.snapshotTime,'new');assert.equal(app.state.connection,'CONNECTED');
  const refresh=intervals.find(i=>i.ms===15000);refresh.fn();const failed=pending.shift();failed.ack(null,{ok:false,error:{code:'UNAVAILABLE',message:'Database unavailable'}});await pause();assert.equal(app.state.connection,'STALE');
  refresh.fn();pending.shift().ack(null,{ok:true,data:{classes:[],serverTime:'restored'}});await pause();assert.equal(app.state.connection,'CONNECTED');
  listeners.offline();assert.equal(app.state.connection,'DISCONNECTED');listeners.online();pending.shift().ack(null,{ok:true,data:{classes:[],serverTime:'online'}});await pause();while(pending.length){pending.shift().ack(null,{ok:true,data:{classes:[],serverTime:'online'}});await pause();}
  renewFail=true;socket.fire('connect_error',{data:{code:'AUTH_REQUIRED'}});await pause();assert.equal(api.current.id,'1');assert.equal(app.state.connection,'RECONNECTING');assert(timers.some(t=>t.ms===5000));
  renewFail=false;timers.find(t=>t.ms===5000).fn();await pause();assert(renewals>=2);while(pending.length){pending.shift().ack(null,{ok:true,data:{classes:[],serverTime:'renewed'}});await pause();}assert.equal(app.state.connection,'CONNECTED');
  socket.fire('connect_error',{data:{code:'AUTH_REQUIRED'}});await pause();const inflight=pending.shift();app.stop();inflight?.ack(null,{ok:true,data:{classes:[],serverTime:'private-old'}});await pause();assert.equal(app.state.snapshotTime,null);
  console.log('PASS RECOVERY CLIENT: '+role+' transport-generation race, stale sync, offline/online and temporary auth recovery; private snapshots cleared on stop');
 }
 let now=Date.now(),fail=true,requests=0,record={token:'access',refreshToken:'refresh',expiresAt:new Date(now-1000).toISOString(),sessionId:'1'};
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const context=vm.createContext({globalThis:null,CLASSENCE_MONITORING_API:'http://127.0.0.1:3000',chrome:{storage:{local:{setAccessLevel:async()=>{},get:async()=>({'classence-student-session':record}),set:async data=>{record=data['classence-student-session'];},remove:async()=>record=null}},runtime:{onMessage:{addListener(){}},getURL:p=>p,id:'test'}},Date:Clock,crypto:crypto.webcrypto,AbortController,setTimeout,clearTimeout,fetch:async()=>{requests++;if(fail)throw new Error('Controlled offline');return {ok:true,json:async()=>({data:{accessToken:'new',refreshToken:'next',expiresAt:new Date(now+900000).toISOString(),absoluteExpiresAt:new Date(now+14400000).toISOString(),sessionId:'1',user:{role:'student'}}})};}});context.globalThis=context;
 vm.runInContext(fs.readFileSync(path.join(root,'student/js/auth-coordinator.js'),'utf8'),context);
 for(let i=0;i<3;i++){await assert.rejects(context.StudentAuthCoordinator.ensure());now+=121000;}
 assert.equal(record.token,'access');fail=false;assert.equal((await context.StudentAuthCoordinator.ensure()).token,'new');assert.equal(requests,4);
 console.log('PASS RECOVERY CLIENT: Student background renewal resumes after three temporary failures without logout or an infinite rapid retry loop');
 fail=true;record={...record,expiresAt:new Date(now-1000).toISOString()};await assert.rejects(context.StudentAuthCoordinator.ensure());assert(record);
 console.log('RECOVERY CLIENT SUMMARY: 3 cases passed (controlled VM, not Chrome).');
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
