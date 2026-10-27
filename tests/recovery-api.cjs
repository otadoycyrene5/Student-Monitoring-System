'use strict';
require('dotenv').config({path:require('node:path').join(__dirname,'../.env'),quiet:true});
const assert=require('node:assert/strict'),crypto=require('node:crypto'),http=require('node:http'),{EventEmitter}=require('node:events');
const pool=require('../src/config/database'),{setup}=require('../src/index'),{attachRealtime,socketPath}=require('../src/realtime'),{createAuthService}=require('../src/services/authService'),{createLiveService}=require('../src/services/liveService'),{io}=require('socket.io-client');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const db=await pool.getConnection(),sockets=[],before={},tables=['users','faculty_profiles','student_profiles','auth_sessions','session_families','refresh_credentials','session_security_events','classes','enrollments','sessions','attendance','session_participants','session_connection_intervals','activity_logs','meet_monitoring','attendance_audit'];
 let realtime,server,failSql=null,allFailed=false,ownerLock,cases=0;
 const wait=async check=>{for(let i=0;i<240;i++){if(await check())return;await pause(50);}throw new Error('Recovery condition timed out');};
 const check=async(name,work)=>{await work();cases++;console.log('PASS RECOVERY API: '+name);};
 const execute=async(...args)=>{if(allFailed||failSql&&String(args[0]).includes(failSql)){const error=Object.assign(new Error('Controlled connection interruption'),{code:'ECONNRESET'});throw error;}return db.execute(...args);};
 const testPool={execute,query:(...args)=>allFailed?Promise.reject(Object.assign(new Error('Controlled outage'),{code:'ECONNRESET'})):db.query(...args),getConnection:async()=>{if(allFailed)throw Object.assign(new Error('Controlled outage'),{code:'ECONNRESET'});const conn=new EventEmitter();Object.assign(conn,{execute:async(...args)=>{if(String(args[0]).includes('GET_LOCK'))ownerLock=conn;return execute(...args);},query:(...a)=>db.query(...a),beginTransaction:()=>db.query('SAVEPOINT recovery'),commit:()=>db.query('RELEASE SAVEPOINT recovery'),rollback:()=>db.query('ROLLBACK TO SAVEPOINT recovery'),release(){}});return conn;}};
 try{
  for(const t of tables){const [[r]]=await db.query('SELECT COUNT(*) n FROM '+t);before[t]=r.n;}await db.beginTransaction();
  const uid=crypto.randomUUID(),password='RecoveryDisposable123!',origin='http://127.0.0.1:5500',extension='chrome-extension://jefdcdmlgafknafmpdondeglcbimdnki';process.env.CLIENT_ORIGIN=origin+','+extension;
  const auth=createAuthService(testPool,900),live=createLiveService(testPool),users=[],credentials=[],identities=[];
  for(const [i,role]of ['faculty','student','faculty'].entries()){const u=await auth.register(role,{email:'recovery-'+i+'-'+uid+'@example.edu',password,fullName:'Recovery '+i,facultyId:'F-'+i+'-'+uid,department:'Computing',academicPosition:'Professor',studentId:'S-'+i+'-'+uid,program:'BSIT',yearLevel:3,section:'BSIT 3-1'});users.push(u);const c=await auth.login({email:u.email,password},true);credentials.push(c);identities.push(await auth.authenticate(c.accessToken));}
  const c=await live.create(identities[0],{name:'Recovery fixture',section:'BSIT 3-1',meet:'https://meet.google.com/abc-defg-hij'});await live.enroll(identities[1],{code:c.code});const session=await live.start(identities[0],c.classId),sid=session.sessionId;
  const instance=setup({pool:testPool}),config={lockName:'recovery_'+uid,reconcileClassIds:[c.classId],pollMs:50};
  async function start(port=0){server=http.createServer(instance.app);realtime=await attachRealtime(server,testPool,[origin,extension],config);instance.app.locals.realtime=realtime;await new Promise(r=>server.listen(port,'127.0.0.1',r));}
  await start();let base='http://127.0.0.1:'+server.address().port;
  const request=async(n,path,body)=>{const response=await fetch(base+'/api/auth/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer '+credentials[n].accessToken},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,...await response.json()};};
  async function connect(n){const s=io(base,{path:socketPath,forceNew:true,transports:['websocket'],reconnection:false,auth:n===1?{token:credentials[n].accessToken}:{client:'faculty-web'},extraHeaders:{Origin:n===1?extension:origin,...(n!==1?{Cookie:'classence_faculty_session='+credentials[n].accessToken}:{})}});sockets.push(s);await new Promise((resolve,reject)=>{s.once('connect',resolve);s.once('connect_error',reject);});return s;}
  const call=(s,event,value={})=>new Promise((resolve,reject)=>s.timeout(5000).emit(event,value,(err,r)=>err?reject(err):resolve(r)));
  let student=await connect(1);assert((await call(student,'student:join-session',{sessionId:sid})).ok);
  const [[first]]=await db.execute('SELECT id,first_joined_at FROM session_participants WHERE session_id=? AND student_user_id=?',[sid,users[1].id]);
  const grant=(await request(1,'monitoring/start',{sessionId:sid,consent:true})).data;
  let seq=0;
  const event=(age=0)=>({sessionId:sid,grantId:grant.grantId,eventId:crypto.randomUUID(),sequence:++seq,tabState:'MEET_TAB_SELECTED',eventType:'RECONCILED',observedAt:new Date(Date.now()-age).toISOString()});
  const monitor=async()=>{const snap=(await request(0,'live/classes')).data;return snap.classes[0].sessions[0].participants[0].monitoring;};
  await check('01 fresh and delayed observations retain original timestamps; delayed state is unknown, never live',async()=>{
   let r=await request(1,'monitoring/event',event());assert.equal(r.status,200);assert.equal((await monitor()).health,'RECENT');
   const delayed=event(10000);r=await request(1,'monitoring/event',delayed);assert.equal(r.status,200);assert.equal(r.data.delayed,true);let m=await monitor();assert.equal(m.health,'STATUS_UNKNOWN');assert.equal(m.tabState,'MEET_TAB_STATE_UNKNOWN');assert.equal(m.lastObservedAt,delayed.observedAt);
   const [[log]]=await db.execute("SELECT event_details FROM activity_logs WHERE session_id=? AND JSON_UNQUOTE(JSON_EXTRACT(event_details,'$.eventId'))=?",[sid,delayed.eventId]);assert.equal(log.event_details.observedAt,delayed.observedAt);assert.equal(log.event_details.delayed,true);
   await request(1,'monitoring/event',event());await db.execute('UPDATE meet_monitoring SET last_report_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 76 SECOND) WHERE session_id=?',[sid]);assert.equal((await monitor()).health,'STATUS_UNKNOWN');
  });
  await check('02 duplicates cannot advance freshness; gaps, future and expired observations are rejected',async()=>{
   const v=event();let r=await request(1,'monitoring/event',v);assert.equal(r.status,200);const stamp=r.data.lastReportAt;
   r=await request(1,'monitoring/event',v);assert.equal(r.data.duplicate,true);assert.equal(r.data.lastReportAt,stamp);
   assert.equal((await request(1,'monitoring/event',{...v,eventId:crypto.randomUUID(),sequence:seq+2})).status,409);
   for(const age of [-10000,130000])assert.equal((await request(1,'monitoring/event',{...v,eventId:crypto.randomUUID(),sequence:seq+1,observedAt:new Date(Date.now()-age).toISOString()})).status,409);
  });
  await check('03 injected MySQL write failure yields 503, rollback and one persisted event after retry',async()=>{
   const v=event();failSql='UPDATE meet_monitoring SET last_sequence';assert.equal((await request(1,'monitoring/event',v)).status,503);failSql=null;
   const [[cursor]]=await db.execute('SELECT last_sequence FROM meet_monitoring WHERE session_id=?',[sid]);assert.equal(Number(cursor.last_sequence),seq-1);
   assert.equal((await request(1,'monitoring/event',v)).status,200);assert.equal((await request(1,'monitoring/event',v)).data.duplicate,true);
   const [[count]]=await db.execute("SELECT COUNT(*) n FROM activity_logs WHERE session_id=? AND JSON_UNQUOTE(JSON_EXTRACT(event_details,'$.eventId'))=?",[sid,v.eventId]);assert.equal(count.n,1);
  });
  await check('04 failed disconnect write is repaired without restarting; rejoin preserves one participant and interval',async()=>{
   failSql='UPDATE session_connection_intervals SET disconnected_at';student.disconnect();await pause(150);await realtime.serial(()=>{});
   let [[row]]=await db.execute('SELECT connection_status FROM session_participants WHERE id=?',[first.id]);assert.equal(row.connection_status,'Online');failSql=null;
   await wait(async()=>{const [[r]]=await db.execute('SELECT connection_status FROM session_participants WHERE id=?',[first.id]);return r.connection_status==='Offline';});
   student=await connect(1);assert((await call(student,'student:join-session',{sessionId:sid})).ok);assert((await call(student,'student:join-session',{sessionId:sid})).ok);
   const [[p]]=await db.execute('SELECT COUNT(*) n,MIN(first_joined_at) first_joined_at FROM session_participants WHERE session_id=? AND student_user_id=?',[sid,users[1].id]);assert.equal(p.n,1);assert.equal(+p.first_joined_at,+first.first_joined_at);
   const [[intervals]]=await db.execute('SELECT COUNT(*) n FROM session_connection_intervals WHERE participant_id=? AND disconnected_at IS NULL',[first.id]);assert.equal(intervals.n,1);
  });
  await check('05 temporary authorization database failure is unavailable, not confirmed logout; same credentials recover',async()=>{
   allFailed=true;assert.equal((await request(1,'student/me')).status,503);await assert.rejects(connect(1),e=>e.data?.code==='UNAVAILABLE');allFailed=false;student=await connect(1);assert((await call(student,'realtime:sync')).ok);assert.equal((await request(1,'student/me')).data.user.email,users[1].email);
  });
  await check('06 lost advisory-lock connection fails closed, reacquires ownership and reconciles before serving snapshots',async()=>{
   await db.execute('SELECT RELEASE_LOCK(?)',[config.lockName]);ownerLock.emit('error',Object.assign(new Error('Controlled owner connection loss'),{code:'ECONNRESET'}));
   assert.equal((await request(0,'live/classes')).status,503);
   await wait(async()=>{try{await realtime.serial(()=>{});return true;}catch{return false;}});assert.equal((await monitor()).health,'STATUS_UNKNOWN');
  });
  await check('07 HTTP/Socket.IO runtime restart retains authentication and original grant but masks old evidence',async()=>{
   await request(1,'monitoring/event',event());const port=server.address().port;await realtime.close();realtime=null;await start(port);
   assert.equal((await request(1,'student/me')).status,200);assert.equal((await request(1,'monitoring/state?sessionId='+sid)).data.grantId,grant.grantId);assert.equal((await monitor()).health,'STATUS_UNKNOWN');
   await request(1,'monitoring/event',event());assert.equal((await monitor()).health,'RECENT');
  });
  await check('08 expired access renews without new consent; revocation rejects old grant and account restoration',async()=>{
   await db.execute('UPDATE auth_sessions SET expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?',[identities[1].sessionId]);assert.equal((await request(1,'student/me')).status,401);
   const r=await request(1,'refresh',{refreshToken:credentials[1].refreshToken,requestId:crypto.randomUUID()});assert.equal(r.status,200);credentials[1]=r.data;assert.equal((await request(1,'monitoring/state?sessionId='+sid)).data.grantId,grant.grantId);
   assert.equal((await request(1,'monitoring/stop',{sessionId:sid})).status,200);assert.equal((await request(1,'monitoring/event',event())).status,403);assert.equal((await request(2,'live/classes')).data.classes.length,0);
  });
  await check('09 session end during an outage rejects pending events; automatic attendance finalizes and first join remains unchanged',async()=>{
   const renewed=(await request(1,'monitoring/start',{sessionId:sid,consent:true})).data;const pending={...event(),grantId:renewed.grantId,sequence:1};await live.end(identities[0],sid);assert.equal((await request(1,'monitoring/event',pending)).status,410);
   const [[a]]=await db.execute('SELECT status,finalized_at FROM attendance WHERE session_id=? AND student_user_id=?',[sid,users[1].id]);assert.equal(a.status,'Present');assert(a.finalized_at);
   const [[p]]=await db.execute('SELECT first_joined_at FROM session_participants WHERE id=?',[first.id]);assert.equal(+p.first_joined_at,+first.first_joined_at);
   const [[overlap]]=await db.execute('SELECT COUNT(*) n FROM session_connection_intervals a JOIN session_connection_intervals b ON a.participant_id=b.participant_id AND a.id<b.id AND a.connected_at<COALESCE(b.disconnected_at,UTC_TIMESTAMP(3)) AND b.connected_at<COALESCE(a.disconnected_at,UTC_TIMESTAMP(3)) WHERE a.participant_id=?',[first.id]);assert.equal(overlap.n,0);
  });
  await realtime.close();realtime=null;await db.rollback();for(const t of tables){const [[r]]=await db.query('SELECT COUNT(*) n FROM '+t);assert.equal(r.n,before[t],t);}
  console.log('PASS RECOVERY API: 10 all original table counts preserved by rollback; failures were injected, MySQL service was not stopped.');cases++;
  console.log('RECOVERY API SUMMARY: '+cases+' cases passed.');
 }finally{failSql=null;allFailed=false;for(const s of sockets)s.disconnect();if(realtime)await realtime.close();if(server?.listening)await new Promise(r=>server.close(r));await db.rollback();db.release();await pool.end();}
})().catch(e=>{console.error('Recovery API failed:',e.code||'',e.message);if(e.stack)console.error(e.stack.split('\n').filter(x=>x.includes('recovery-api.cjs')).join('\n'));process.exitCode=1;});
