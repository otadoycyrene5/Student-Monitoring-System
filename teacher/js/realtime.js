
(()=>{
  'use strict';
  const faculty=Boolean(window.FacultyAPI),api=faculty?FacultyAPI:StudentAPI;
  const base=document.querySelector('meta[name="classence-api"]')?.content||'http://127.0.0.1:3000';
  const e=UI.escape;
  let socket=null,owner=null,snapshot={classes:[]},status='Connecting',error='',busy=false,syncing=null,dirty=false,generation=0,transportEpoch=0,snapshotValid=false,lastSyncAt=0,authFlight=null,authTimer=null,authFailures=0;
  function stop(){generation++;transportEpoch++;snapshotValid=false;clearTimeout(authTimer);authTimer=null;socket?.disconnect();socket=null;owner=null;snapshot={classes:[]};status='Disconnected';error='';busy=false;syncing=null;dirty=false;paint();}
  function call(event,value={}){const active=socket;return new Promise((resolve,reject)=>{if(!active?.connected)return reject(new Error('Connection unavailable. Please reconnect.'));active.timeout(10000).emit(event,value,(timeout,result)=>{if(timeout)return reject(new Error('No confirmation received. Refresh to check the current state before retrying.'));if(!result?.ok)return reject(Object.assign(new Error(result?.error?.message||'Request failed.'),{code:result?.error?.code}));resolve(result.data);});});}
  async function sync(rejoin=false){
    const epoch=transportEpoch,current=generation;
    if(syncing?.epoch===epoch){dirty=true;return syncing.promise;}
    const job={epoch,promise:null};syncing=job;
    job.promise=(async()=>{
      let next=await call('realtime:sync');


      if(faculty&&!next.summary){
        const histories=await Promise.all(next.classes.map(c=>api.request('/api/auth/live/classes/'+encodeURIComponent(c.id)+'/sessions').then(r=>r.data)));
        const sessions=histories.flat();
        next={...next,summary:{classes:next.classes.length,students:new Set(next.classes.flatMap(c=>c.students.map(s=>s.id))).size,active:sessions.filter(s=>s.status==='Live').length,completed:sessions.filter(s=>s.status==='Completed').length}};
      }
      if(current!==generation||epoch!==transportEpoch||!api.current)return;
      if(rejoin&&!faculty){for(const c of next.classes)for(const session of c.sessions)if(session.status==='Live'&&session.participants.some(p=>p.participation==='Joined'))await call('student:join-session',{sessionId:session.id});next=await call('realtime:sync');}
      if(current!==generation||epoch!==transportEpoch||!socket?.connected||!api.current)return;
      snapshot=next;snapshotValid=true;lastSyncAt=Date.now();status='Connected';error='';authFailures=0;paint();
      window.dispatchEvent(new Event('faculty-data-updated'));
    })();
    try{return await job.promise;}catch(err){if(current===generation&&epoch===transportEpoch)throw err;}finally{if(syncing===job){syncing=null;if(dirty){dirty=false;queueMicrotask(()=>sync().catch(failure));}}}
  }
  async function invalid(){
    if(authFlight)return authFlight;
    const current=generation;snapshotValid=false;status='Reconnecting';socket?.disconnect();paint();health();
    authFlight=(async()=>{try{await api.renew(true);if(current===generation&&api.current)socket?.connect();}catch(err){
      if(current!==generation)return;
      if(err.status===401||err.status===403){stop();await api.invalidateSession();window.dispatchEvent(new Event(faculty?'faculty-realtime-auth-check':'student-realtime-auth-check'));status='Authentication required';paint();}
      else{status='Reconnecting';error='Authentication connection interrupted; retrying.';paint();clearTimeout(authTimer);authTimer=setTimeout(()=>invalid(),Math.min(120000,5000*2**Math.min(authFailures++,5)));}
    }})().finally(()=>authFlight=null);return authFlight;
  }
  window.addEventListener(faculty?'faculty-session-renewed':'student-session-renewed',()=>{if(socket){socket.disconnect();socket.connect();}});
  function ensure(){if(!api.current){if(socket)stop();return;}if(socket&&owner===api.current.id)return;stop();owner=api.current.id;status='Connecting';const current=generation;
    socket=io(base,{path:'/api/auth/socket.io',autoConnect:false,...(!faculty?{transports:['websocket']}:{}),withCredentials:faculty,auth:faculty?{client:'faculty-web'}:callback=>api.socketAuth(callback),reconnection:true,reconnectionDelay:500,reconnectionDelayMax:5000,randomizationFactor:.5,timeout:10000});
    socket.on('connect',()=>{if(current!==generation)return;transportEpoch++;snapshotValid=false;status='Reconnecting';error='';sync(true).catch(failure);});
    socket.on('disconnect',reason=>{if(current!==generation)return;transportEpoch++;snapshotValid=false;status='Disconnected';paint();health();window.dispatchEvent(new Event('faculty-data-updated'));if(reason==='io server disconnect'&&api.current)setTimeout(()=>{if(current===generation)socket?.connect();},1500);});
    socket.io.on('reconnect_attempt',()=>{if(current!==generation)return;status='Reconnecting';snapshotValid=false;paint();health();});
    socket.on('connect_error',err=>{if(current!==generation)return;status='Disconnected';error=err.data?.code==='AUTH_REQUIRED'?'Session expired or revoked.':'Cannot connect to real-time backend.';paint();if(['AUTH_REQUIRED','FORBIDDEN'].includes(err.data?.code))invalid();});
    socket.on('session:error',value=>{if(current!==generation)return;if(value.code==='AUTH_REQUIRED')invalid();else{error=value.message;paint();}});
    for(const event of ['session:started','session:ended','session:participants','participant:connected','participant:disconnected','monitoring:updated'])socket.on(event,value=>{if(event!=='monitoring:updated')window.FacultyRecords?.invalidateRead(value?.sessionId);sync().catch(failure);});
    socket.on('session:ended',()=>window.StudentMonitoring?.refresh());
    socket.connect();paint();
  }
  function failure(err){error=err.message;snapshotValid=false;status=socket?.connected?'Stale':'Disconnected';paint();health();window.dispatchEvent(new Event('faculty-data-updated'));if(err.code==='AUTH_REQUIRED')invalid();}
  const filters = { query: '', connectionFilter: '', tabFilter: '', activityFilter: '', attendanceFilter: '' };
  const badge = UI.badge;
  const activityBadge = value => { const display = UI.meetActivity(value); return display==='On Another Tab'?'<span class="badge inactive">On Another Tab</span>':badge(display); };
  function activityFor(sessionId,studentId) {
    const session=snapshot.classes.flatMap(c=>c.sessions).find(s=>s.id===sessionId);
    if (session?.status==='Completed') return 'Session Ended';
    if (owner!==api.current?.id || status!=='Connected' || !snapshotValid || Date.now()-lastSyncAt>30000) return 'Not Monitoring';
    const monitoring=session?.participants.find(p=>p.userId===studentId)?.monitoring;
    const now=Date.parse(snapshot.serverTime)+(Date.now()-lastSyncAt),report=Date.parse(monitoring?.lastReportAt);
    if(monitoring?.health!=='RECENT'||monitoring.delayed||!Number.isFinite(report)||now<report||now-report>(snapshot.freshnessMs||75000)||!(Date.parse(monitoring.expiresAt)>now))return 'Not Monitoring';
    if(monitoring.tabState==='MEET_TAB_SELECTED')return 'Active';
    if(monitoring.tabState!=='MEET_TAB_NOT_SELECTED')return 'Not Monitoring';
    const since=Date.parse(monitoring.unfocusedSince);
    return Number.isFinite(since)&&since<=report&&now-since>=300000?'Inactive':'On Another Tab';
  }
  const metricCards = items => `<div class="grid metrics">${items.map(([label,value])=>`<div class="card"><small>${e(label)}</small><div class="metric">${UI.text(value)}</div></div>`).join('')}</div>`;
  function renderMonitor(target) {
    if (!target.isConnected) return;
    const owned = owner === api.current?.id ? snapshot.classes : [];
    const live = owned.flatMap(c=>c.sessions.filter(s=>s.status==='Live').map(s=>({c,s})));
    const selected = live.find(({s})=>s.id===target.dataset.sessionId) || live.find(({c})=>c.id===target.dataset.classId) || live[0];
    if (!selected) {
      UI.patchHTML(target, `<div class="panel empty"><h2>${snapshotValid?'No active session':'Loading monitoring...'}</h2><p>${e(error || (snapshotValid?'Start monitoring from a class details screen.':'Waiting for current session information.'))}</p><button type="button" class="secondary" data-action="navigate" data-page="classes">Choose a class</button></div>`);
      return;
    }
    const {c,s} = selected;
    const saved = window.FacultyRecords?.readSnapshot(s.id);
    const fresh = status==='Connected' && snapshotValid && Date.now()-lastSyncAt<=30000;
    const records = c.students.map(student=>{
      const participant=s.participants.find(p=>p.userId===student.id),m=participant?.monitoring;
      const recent=fresh && m?.health==='RECENT' && m.lastReportAt && Date.now()-Date.parse(m.lastReportAt)<=(snapshot.freshnessMs||75000) && Date.parse(m.expiresAt)>Date.now() && !m.delayed;
      const tabState=recent?m.tabState:'MEET_TAB_STATE_UNKNOWN';
      const tab=({MEET_TAB_SELECTED:'Active',MEET_TAB_NOT_SELECTED:'Inactive',MEET_TAB_NOT_OPEN:'Not Detected',MEET_TAB_CLOSED:'Not Detected'})[tabState] || 'Not Detected';
      const latest=[m?.lastObservedAt,m?.lastReportAt,participant?.lastJoinedAt,participant?.lastLeftAt].filter(Boolean).sort((a,b)=>Date.parse(b)-Date.parse(a))[0];
      const popupConnection=participant?.popupConnection||participant?.connection||'Not Connected',connection=!participant?'Not Connected':popupConnection==='Online'||recent?'Online':'Offline';
      return {student,participant,tabState,latest,st:{connection,popupConnection,tab,activity:activityFor(s.id,student.id),attendance:saved?.rows.find(row=>row.studentId===student.id)?.status||'Unknown'}};
    });
    const count=(key,value)=>records.filter(row=>row.st[key]===value).length;
    const matches=records.filter(row=>(row.student.name+' '+(row.student.email||'')).toLowerCase().includes(filters.query.toLowerCase()) && (!filters.connectionFilter||row.st.connection===filters.connectionFilter) && (!filters.tabFilter||row.st.tab===filters.tabFilter) && (!filters.activityFilter||row.st.activity===filters.activityFilter) && (!filters.attendanceFilter||row.st.attendance===filters.attendanceFilter));
    const options=[['connectionFilter','Connection',['Online','Offline']],['tabFilter','Meet Tab',['Active','Inactive','Not Detected']],['activityFilter','Meet Tab Activity',['Active','On Another Tab','Inactive','Not Monitoring']],['attendanceFilter','Attendance',['Present','Late','Not Joined']]];
    UI.patchHTML(target,`<section class="panel session-header" data-real-class="${e(c.id)}" data-real-session="${e(s.id)}"><div class="flex"><div>${badge(fresh?'Live':'Unknown')}<h2>${UI.text(c.name)}</h2><small>${UI.text(c.section)} &middot; Started ${UI.time(s.startedAt)} &middot; ${Math.max(0,Math.floor((Date.now()-Date.parse(s.startedAt))/60000))} min elapsed</small></div><button type="button" class="primary right" data-rt="end" data-rt-id="${e(s.id)}" ${busy||!fresh?'disabled':''}>End session</button></div></section>${metricCards([['Enrolled',c.students.length],['Online',fresh?count('connection','Online'):null],['Offline',fresh?count('connection','Offline'):null],['Active',fresh?count('activity','Active'):null],['On Another Tab',fresh?count('activity','On Another Tab'):null],['Inactive',fresh?count('activity','Inactive'):null]])}<section class="panel"><h2>Student Monitoring</h2><div class="toolbar monitoring-search"><input id="search" class="search-input" type="search" data-monitor-query value="${e(filters.query)}" placeholder="Search students" aria-label="Search students"></div><div class="monitoring-filters">${options.map(([key,label,values])=>`<label class="control" for="${key}">${label}<select id="${key}" data-monitor-filter="${key}"><option value="">All</option>${values.map(value=>`<option ${filters[key]===value?'selected':''}>${e(value)}</option>`).join('')}</select></label>`).join('')}</div>${UI.table(['Student name','Connection','Meet tab','Meet tab activity','Attendance','First join','Last update'],matches.map(row=>[UI.text(row.student.name),`${badge(row.st.connection)}<small class="popup-connection">Popup: ${e(row.st.popupConnection)}</small>`,`<span data-meet-health="${e(s.id+':'+row.student.id)}" data-meet-state="${e(row.tabState)}">${badge(row.st.tab)}</span>`,activityBadge(row.st.activity),`<button type="button" class="link" data-faculty-records="attendance" data-class-id="${e(c.id)}" data-session-id="${e(s.id)}" aria-label="Review attendance for ${UI.text(row.student.name)}">${badge(row.st.attendance)}</button>`,UI.time(row.participant?.firstJoinedAt),UI.time(row.latest)]),'No matching records.',matches.map(row=>row.student.id))}</section>${error?`<p role="status">${e(error)}</p>`:''}`);
  }
  function paint() {
    const target=document.getElementById('real-realtime');
    if (target) renderMonitor(target);
  }
  function health() {
    if(status==='Connected'&&Date.now()-lastSyncAt>30000){snapshotValid=false;status='Stale';}
    paint();
  }
  document.addEventListener('input',event=>{if(event.target.matches('[data-monitor-query]')){filters.query=event.target.value;paint();}});
  document.addEventListener('change',event=>{if(event.target.dataset.monitorFilter){filters[event.target.dataset.monitorFilter]=event.target.value;paint();}});
  document.addEventListener('click',async event=>{const el=event.target.closest('[data-rt]');if(!el)return;event.preventDefault();if(busy)return;busy=true;try{const action=el.dataset.rt;if(action==='refresh'){if(!socket?.connected){socket?.connect();status='Connecting';}else await sync();}else{const names={start:'faculty:start-session',end:'faculty:end-session',join:'student:join-session',leave:'student:leave-session'};if(action==='leave')await window.StudentMonitoring?.stop();await call(names[action],{[action==='start'?'classId':'sessionId']:el.dataset.rtId});await sync();}}catch(err){failure(err);}finally{busy=false;paint();}});
  window.addEventListener(faculty?'faculty-session-ended':'student-session-ended',stop);
  window.addEventListener('offline',()=>{snapshotValid=false;status='Disconnected';paint();health();window.dispatchEvent(new Event('faculty-data-updated'));});
  window.addEventListener('online',()=>{if(api.current){status='Reconnecting';socket?.connect();if(socket?.connected)sync(true).catch(failure);}});
  window.addEventListener('pagehide',()=>socket?.disconnect());
  setInterval(health,5000);
  setInterval(()=>{if(socket?.connected&&api.current)sync().catch(failure);},15000);
  window.ClassenceRealtime={get data(){return owner===api.current?.id&&snapshotValid?snapshot:null;},get state(){return {connection:({Connected:'CONNECTED',Connecting:'RECONNECTING',Reconnecting:'RECONNECTING',Disconnected:'DISCONNECTED',Stale:'STALE','Authentication required':'AUTHENTICATION_REQUIRED'})[status]||'UNKNOWN',snapshotTime:snapshot.serverTime||null};},ensure,mount:paint,stop,activityFor,refresh:()=>sync().catch(failure),command:call};
})();
