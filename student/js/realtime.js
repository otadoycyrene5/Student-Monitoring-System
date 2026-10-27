
(()=>{
  'use strict';
  const api=StudentAPI;
  const base=document.querySelector('meta[name="classence-api"]')?.content||'http://127.0.0.1:3000';
  const e=UI.escape;

  let socket=null,owner=null,snapshot={classes:[]},status='Connecting',error='',busy=false,syncing=null,dirty=false,generation=0,transportEpoch=0,snapshotValid=false,lastSyncAt=0,authFlight=null,authTimer=null,authFailures=0;
  const button=(text,action,id='',style=action==='refresh'?'secondary':'primary')=>`<button type="button" class="${style}" data-rt="${action}" data-rt-id="${e(id)}" ${busy||status!=='Connected'&&action!=='refresh'?'disabled':''}>${text}</button>`;
  const openRegisteredMeet=async url=>{
    if(!globalThis.chrome?.runtime?.sendMessage)throw new Error('Open Google Meet is available in the loaded Chrome extension.');
    const result=await new Promise((resolve,reject)=>chrome.runtime.sendMessage({type:'OPEN_REGISTERED_MEET',url},reply=>{const error=chrome.runtime.lastError;if(error)return reject(new Error('Cannot contact the extension background service. Reload the extension and try again.'));if(!reply?.ok)return reject(new Error(reply?.message||'Cannot open the registered Google Meet.'));resolve(reply.data);}));
    return result;
  };
  function stop(){generation++;transportEpoch++;snapshotValid=false;clearTimeout(authTimer);authTimer=null;socket?.disconnect();socket=null;owner=null;snapshot={classes:[]};status='Disconnected';error='';busy=false;syncing=null;dirty=false;paint();}
  function call(event,value={}){const active=socket;return new Promise((resolve,reject)=>{if(!active?.connected)return reject(new Error('Connection unavailable. Please reconnect.'));active.timeout(10000).emit(event,value,(timeout,result)=>{if(timeout)return reject(new Error('No confirmation received. Refresh to check the current state before retrying.'));if(!result?.ok)return reject(Object.assign(new Error(result?.error?.message||'Request failed.'),{code:result?.error?.code}));resolve(result.data);});});}
  async function sync(rejoin=false){
    const epoch=transportEpoch,current=generation;
    if(syncing?.epoch===epoch){dirty=true;return syncing.promise;}
    const job={epoch,promise:null};syncing=job;
    job.promise=(async()=>{
      let next=await call('realtime:sync');
      if(current!==generation||epoch!==transportEpoch||!api.current)return;
      if(rejoin){for(const c of next.classes)for(const session of c.sessions)if(session.status==='Live'&&session.participants.some(p=>p.participation==='Joined')){await call('student:join-session',{sessionId:session.id});if(window.StudentMonitoring)await window.StudentMonitoring.autoStart(session.id,api.current?.email).catch(()=>{});}next=await call('realtime:sync');}
      if(current!==generation||epoch!==transportEpoch||!socket?.connected||!api.current)return;
      snapshot=next;snapshotValid=true;lastSyncAt=Date.now();status='Connected';error='';authFailures=0;paint();window.dispatchEvent(new Event('student-data-updated'));
    })();
    try{return await job.promise;}catch(err){if(current===generation&&epoch===transportEpoch)throw err;}finally{if(syncing===job){syncing=null;if(dirty){dirty=false;queueMicrotask(()=>sync().catch(failure));}}}
  }
  async function invalid(){
    if(authFlight)return authFlight;
    const current=generation;snapshotValid=false;status='Reconnecting';socket?.disconnect();paint();health();
    authFlight=(async()=>{try{await api.renew(true);if(current===generation&&api.current)socket?.connect();}catch(err){
      if(current!==generation)return;
      if(err.status===401||err.status===403){stop();await api.invalidateSession();window.dispatchEvent(new Event('student-realtime-auth-check'));status='Authentication required';paint();}
      else{status='Reconnecting';error='Authentication connection interrupted; retrying.';paint();clearTimeout(authTimer);authTimer=setTimeout(()=>invalid(),Math.min(120000,5000*2**Math.min(authFailures++,5)));}
    }})().finally(()=>authFlight=null);return authFlight;
  }
  window.addEventListener('student-session-renewed',()=>{if(socket){socket.disconnect();socket.connect();}});
  function ensure(){if(!api.current){if(socket)stop();return;}if(socket&&owner===api.current.id)return;stop();owner=api.current.id;status='Connecting';const current=generation;
    socket=io(base,{path:'/api/auth/socket.io',autoConnect:false,transports:['websocket'],withCredentials:false,auth:callback=>api.socketAuth(callback),reconnection:true,reconnectionDelay:500,reconnectionDelayMax:5000,randomizationFactor:.5,timeout:10000});
    socket.on('connect',()=>{if(current!==generation)return;transportEpoch++;snapshotValid=false;status='Reconnecting';error='';sync(true).catch(failure);});
    socket.on('disconnect',reason=>{if(current!==generation)return;transportEpoch++;snapshotValid=false;status='Disconnected';paint();health();if(reason==='io server disconnect'&&api.current)setTimeout(()=>{if(current===generation)socket?.connect();},1500);});
    socket.io.on('reconnect_attempt',()=>{if(current!==generation)return;status='Reconnecting';snapshotValid=false;paint();health();});
    socket.on('connect_error',err=>{if(current!==generation)return;status='Disconnected';error=err.data?.code==='AUTH_REQUIRED'?'Session expired or revoked.':'Cannot connect to real-time backend.';paint();if(['AUTH_REQUIRED','FORBIDDEN'].includes(err.data?.code))invalid();});
    socket.on('session:error',value=>{if(current!==generation)return;if(value.code==='AUTH_REQUIRED')invalid();else{error=value.message;paint();}});
    for(const event of ['session:started','session:ended','session:participants','participant:connected','participant:disconnected','monitoring:updated'])socket.on(event,()=>sync().catch(failure));
    socket.on('session:ended',()=>window.StudentMonitoring?.refresh());
    socket.connect();paint();
  }
  function failure(err){error=err.message;snapshotValid=false;status=socket?.connected?'Stale':'Disconnected';paint();health();if(err.code==='AUTH_REQUIRED')invalid();}
  function paint(){const target=document.getElementById('real-realtime');if(!target)return;const indicator=target.querySelector('[data-rt-status]');if(indicator)indicator.textContent=status+(error?' ? '+error:'');
    if(target.contains(document.activeElement)&&['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName))return;
    const selected=target.dataset.studentClass;
    const classes=snapshot.classes.filter(c=>selected?c.id===selected:c.sessions.some(s=>s.status==='Live'));
    UI.patchHTML(target,`<section class="card" data-real-panel><p role="status" data-rt-status>${e(status)}${error?' - '+e(error):''}</p>${classes.map(c=>`<section data-real-class="${e(c.id)}">${selected?'':`<h3>${UI.text(c.name)}</h3><p class="muted">${UI.text(c.section)} &middot; ${UI.text(c.facultyName)}</p>`}${c.sessions.filter(s=>s.status==='Live').map(s=>{const self=s.participants[0],joined=self?.participation==='Joined',monitoringEnabled=joined&&['RECENT','STATUS_UNKNOWN'].includes(self?.monitoring?.health);return `<div data-real-session="${e(s.id)}"><p>${UI.badge('Live')} &middot; Started ${UI.time(s.startedAt)}</p><div class="student-session-actions">${button(joined?'Leave Session':'Join Session',joined?'leave':'join',s.id)}${joined?`<button type="button" class="secondary" data-rt="open-meet" data-rt-meet="${e(c.meet)}" ${busy||status!=='Connected'?'disabled':''}>Open Google Meet</button>`:''}</div>${selected&&joined?(monitoringEnabled?'<p class="student-monitoring-enabled"><span class="badge active">Monitoring Enabled</span></p>':`<button type="button" class="secondary full student-monitoring-enable" data-action="enable-monitoring" data-session-id="${e(s.id)}" ${busy||status!=='Connected'?'disabled':''}>Enable Google Meet Monitoring</button>`):''}<p data-rt-connection>Connection: ${status!=='Connected'?'Unknown':self?.connection==='Online'?'Connected':self?'Disconnected':'Not Connected'} &middot; ${e(self?.participation||'Not Joined')}</p></div>`;}).join('')}${!c.sessions.some(s=>s.status==='Live')?'<p>No active session right now.</p>':''}</section>`).join('')||`<p>${snapshotValid?'No active session right now.':'Checking your sessions...'}</p>`}</section>`);
    health();
  }
  function health(){if(status==='Connected'&&Date.now()-lastSyncAt>30000){snapshotValid=false;status='Stale';const indicator=document.querySelector('[data-rt-status]');if(indicator)indicator.textContent='Stale ? refreshing current state';}}

  document.addEventListener('click',async event=>{const el=event.target.closest('[data-rt]');if(!el)return;event.preventDefault();if(busy)return;busy=true;try{const action=el.dataset.rt;if(action==='refresh'){if(!socket?.connected){socket?.connect();status='Connecting';}else await sync();}else if(action==='open-meet')await openRegisteredMeet(el.dataset.rtMeet);else{const names={join:'student:join-session',leave:'student:leave-session'};if(action==='leave')await window.StudentMonitoring?.stop();await call(names[action],{sessionId:el.dataset.rtId});if(action==='join'&&window.StudentMonitoring)await window.StudentMonitoring.autoStart(el.dataset.rtId,api.current?.email).catch(()=>{});await sync();}}catch(err){failure(err);}finally{busy=false;paint();}});
  window.addEventListener('student-session-ended',stop);
  window.addEventListener('offline',()=>{snapshotValid=false;status='Disconnected';paint();health();});
  window.addEventListener('online',()=>{if(api.current){status='Reconnecting';socket?.connect();if(socket?.connected)sync(true).catch(failure);}});
  window.addEventListener('pagehide',()=>socket?.disconnect());
  setInterval(health,5000);
  setInterval(()=>{if(socket?.connected&&api.current)sync().catch(failure);},15000);
  window.ClassenceRealtime={get data(){return owner===api.current?.id&&snapshotValid?snapshot:null;},refresh:()=>sync(),get state(){return {connection:({Connected:'CONNECTED',Connecting:'RECONNECTING',Reconnecting:'RECONNECTING',Disconnected:'DISCONNECTED',Stale:'STALE','Authentication required':'AUTHENTICATION_REQUIRED'})[status]||'UNKNOWN',snapshotTime:snapshot.serverTime||null};},ensure,mount:paint,stop};
})();
