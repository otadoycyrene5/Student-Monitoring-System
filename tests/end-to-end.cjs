'use strict';

require('dotenv').config({path:require('node:path').join(__dirname,'../.env'),quiet:true});
const assert=require('node:assert/strict'),crypto=require('node:crypto'),http=require('node:http');
const pool=require('../src/config/database'),{setup}=require('../src/index'),{attachRealtime,socketPath}=require('../src/realtime'),{io}=require('socket.io-client');
(async()=>{
  const db=await pool.getConnection(),sockets=[],before={},tokens=[],users=[],checks=[];
  const tables=['users','faculty_profiles','student_profiles','auth_sessions','classes','enrollments','sessions','attendance','session_participants','session_connection_intervals','activity_logs','meet_monitoring'];
  let server,realtime;
  const check=async(name,work)=>{await work();checks.push(name);console.log('PASS E2E: '+name);};
  try{
    for(const t of tables){const [[r]]=await db.query('SELECT COUNT(*) n FROM `'+t+'`');before[t]=r.n;}
    await db.beginTransaction();
    const fixturePool={execute:(...a)=>db.execute(...a),query:(...a)=>db.query(...a),getConnection:async()=>({execute:(...a)=>db.execute(...a),query:(...a)=>db.query(...a),beginTransaction:()=>db.query('SAVEPOINT e2e_work'),commit:()=>db.query('RELEASE SAVEPOINT e2e_work'),rollback:()=>db.query('ROLLBACK TO SAVEPOINT e2e_work'),release(){}})};
    const origin='http://127.0.0.1:5500',extension='chrome-extension://jefdcdmlgafknafmpdondeglcbimdnki',uid=crypto.randomUUID(),password='EndToEndPass123!';
    process.env.CLIENT_ORIGIN=origin+','+extension;process.env.AUTH_REGISTER_LIMIT='100';process.env.AUTH_LOGIN_LIMIT='100';
    const app=setup({pool:fixturePool}).app;server=http.createServer(app);
    realtime=await attachRealtime(server,fixturePool,[origin,extension],{lockName:'e2e_'+uid,reconcileClassIds:['18446744073709551615']});app.locals.realtime=realtime;
    await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
    const request=async(n,path,body)=>{const response=await fetch(base+'/api/auth/'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(tokens[n]?{Authorization:'Bearer '+tokens[n]}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const json=await response.json();assert(!/password_hash|token_hash|\$argon2|SELECT .*FROM/.test(JSON.stringify(json)));return {status:response.status,...json};};
    await check('01 HTTP registration and login: two Faculty, three Students, correct profiles, absolute 900-second lifetime',async()=>{
      for(let i=0;i<5;i++){
        const role=i<2?'faculty':'student',body={fullName:'Step8 '+role+' '+i,email:'step8-'+i+'-'+uid+'@example.edu',password,confirmPassword:password,...(i<2?{facultyId:'F-'+i+'-'+uid,department:'Computing',academicPosition:'Professor'}:{studentId:'S-'+i+'-'+uid,program:'BSIT',yearLevel:3,section:'BSIT 3-1'})};
        const registration=await request(-1,role+'/register',body);assert.equal(registration.status,201);users.push(registration.data.user);
        const login=await request(-1,'login',{email:body.email,password});assert.equal(login.status,200);assert.equal(login.data.expiresIn,900);tokens.push(login.data.accessToken);
        const profile=await request(i,role+'/me');assert.equal(profile.data.user.email,body.email);assert.equal(profile.data.user.role,role);
      }
    });
    let ca,cb;
    await check('02 real class creation, distinct codes, enrollment idempotency and identity injection rejection',async()=>{
      ca=(await request(0,'live/classes',{name:'Step8 Class A',section:'BSIT 3-1',meet:'https://meet.google.com/abc-defg-hij'})).data;
      cb=(await request(1,'live/classes',{name:'Step8 Class B',section:'BSIT 3-1',meet:'https://meet.google.com/xyz-abcd-efg'})).data;
      assert.match(ca.code,/^CL-[A-F0-9]{6}$/);assert.notEqual(ca.code,cb.code);
      for(const n of [2,3,4])assert.equal((await request(n,'live/enroll',{code:n===4?cb.code:ca.code})).status,200);
      assert.equal((await request(2,'live/enroll',{code:ca.code})).status,200);
      assert.equal((await request(2,'live/enroll',{code:ca.code,studentId:users[4].id})).status,400);
      assert.equal((await request(2,'live/enroll',{code:'IT301-A7'})).status,400);
      const [[count]]=await db.execute('SELECT COUNT(*) n FROM enrollments WHERE class_id=?',[ca.classId]);assert.equal(count.n,2);
    });
    const connect=async n=>{const socket=io(base,{path:socketPath,transports:['websocket'],forceNew:true,reconnection:false,auth:n<2?{client:'faculty-web'}:{token:tokens[n]},extraHeaders:{Origin:n<2?origin:extension,...(n<2?{Cookie:'classence_faculty_session='+tokens[n]}:{})}});sockets.push(socket);await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});return socket;};
    const call=(s,event,payload={})=>new Promise((resolve,reject)=>s.timeout(5000).emit(event,payload,(error,result)=>error?reject(error):resolve(result)));
    const ok=async(...args)=>{const response=await call(...args);assert.equal(response.ok,true,JSON.stringify(response));return response.data;};
    const clients=[];for(let i=0;i<5;i++)clients.push(await connect(i));
    let sa,sb,updates=0,leaks=0;
    await check('03 simultaneous session starts and joins, class isolation, unauthorized socket operations',async()=>{
      for(const c of clients)await ok(c,'realtime:sync');
      const started=await Promise.all([ok(clients[0],'faculty:start-session',{classId:ca.classId}),ok(clients[0],'faculty:start-session',{classId:ca.classId}),ok(clients[1],'faculty:start-session',{classId:cb.classId})]);
      assert.equal(started[0].sessionId,started[1].sessionId);sa=started[0].sessionId;sb=started[2].sessionId;
      assert.equal((await call(clients[1],'faculty:join-class',{classId:ca.classId})).ok,false);
      assert.equal((await call(clients[4],'student:join-session',{sessionId:sa})).ok,false);
      await Promise.all([ok(clients[2],'student:join-session',{sessionId:sa}),ok(clients[3],'student:join-session',{sessionId:sa}),ok(clients[4],'student:join-session',{sessionId:sb})]);
      clients[0].on('monitoring:updated',()=>updates++);clients[1].on('monitoring:updated',e=>{if(e.sessionId===sa)leaks++;});
      const a=await ok(clients[0],'realtime:sync'),b=await ok(clients[1],'realtime:sync');assert.equal(a.classes.length,1);assert.equal(b.classes.length,1);assert.equal(a.classes[0].sessions[0].participants.length,2);
      const student=await ok(clients[2],'realtime:sync');assert.equal(student.classes[0].sessions[0].participants.length,1);assert(!student.classes[0].sessions[0].meetEvents);
    });
    const grants=[],events=[];
    await check('04 consent enforced, simultaneous authorized reports, exact DB association, ordered deduplication',async()=>{
      assert.equal((await request(4,'monitoring/start',{sessionId:sa,consent:true})).status,403);
      assert.equal((await request(2,'monitoring/start',{sessionId:sa,consent:false})).status,400);
      for(const n of [2,3]){grants[n]=(await request(n,'monitoring/start',{sessionId:sa,consent:true})).data;events[n]={sessionId:sa,grantId:grants[n].grantId,eventId:crypto.randomUUID(),sequence:1,tabState:n===2?'MEET_TAB_SELECTED':'MEET_TAB_NOT_SELECTED',eventType:'TAB_STATE'};}
      const start=performance.now(),results=await Promise.all([request(2,'monitoring/event',events[2]),request(3,'monitoring/event',events[3])]);assert(results.every(r=>r.status===200));console.log('MEASURE: two concurrent report requests completed in '+Math.round(performance.now()-start)+' ms');
      assert.equal((await request(2,'monitoring/event',events[2])).data.duplicate,true);
      assert.equal((await request(4,'monitoring/event',events[2])).status,403);
      assert.equal((await request(2,'monitoring/event',{...events[2],sequence:2,eventId:crypto.randomUUID(),url:'https://private.example'})).status,400);
      const [[count]]=await db.execute("SELECT COUNT(*) n FROM activity_logs WHERE session_id=? AND JSON_UNQUOTE(JSON_EXTRACT(event_details,'$.action'))='TAB_STATE'",[sa]);assert.equal(count.n,2);
      const snapshot=await ok(clients[0],'realtime:sync');assert(snapshot.classes[0].sessions[0].participants.every(p=>p.monitoring.health==='RECENT'));assert(updates>=2);assert.equal(leaks,0);
    });
    await check('05 popup socket disconnect preserves consent and reports; rejoin preserves first join',async()=>{
      const [[original]]=await db.execute('SELECT first_joined_at FROM session_participants WHERE session_id=? AND student_user_id=?',[sa,users[2].id]);
      clients[2].disconnect();await new Promise(r=>setTimeout(r,100));await realtime.serial(()=>{});
      const [[p]]=await db.execute('SELECT connection_status,participation_status FROM session_participants WHERE session_id=? AND student_user_id=?',[sa,users[2].id]);assert.equal(p.connection_status,'Offline');assert.equal(p.participation_status,'Joined');
      assert.equal((await request(2,'monitoring/event',{...events[2],eventId:crypto.randomUUID(),sequence:2,tabState:'MEET_TAB_NOT_SELECTED'})).status,200);
      clients[2]=await connect(2);await ok(clients[2],'student:join-session',{sessionId:sa});
      const [[rejoined]]=await db.execute('SELECT first_joined_at FROM session_participants WHERE session_id=? AND student_user_id=?',[sa,users[2].id]);assert.equal(+rejoined.first_joined_at,+original.first_joined_at);
    });
    await check('06 stale observations masked; withdrawal and reauthentication require fresh consent',async()=>{
      await db.execute('UPDATE meet_monitoring SET last_report_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 76 SECOND) WHERE session_id=? AND student_user_id=?',[sa,users[2].id]);
      const snapshot=await ok(clients[0],'realtime:sync'),p=snapshot.classes[0].sessions[0].participants.find(p=>p.userId===String(users[2].id));assert.equal(p.monitoring.health,'STATUS_UNKNOWN');assert.equal(p.monitoring.tabState,'MEET_TAB_STATE_UNKNOWN');
      assert.equal((await request(2,'monitoring/stop',{sessionId:sa})).status,200);
      assert.equal((await request(2,'monitoring/event',{...events[2],eventId:crypto.randomUUID(),sequence:3})).status,403);
      const login=await request(-1,'login',{email:users[2].email,password});tokens[2]=login.data.accessToken;
      assert.equal((await request(2,'monitoring/event',{...events[2],eventId:crypto.randomUUID(),sequence:3})).status,403);
      grants[2]=(await request(2,'monitoring/start',{sessionId:sa,consent:true})).data;assert.notEqual(grants[2].grantId,events[2].grantId);
    });
    await check('07 leave revokes monitoring, end/report race closes intervals, repeated end is safe',async()=>{
      await ok(clients[3],'student:leave-session',{sessionId:sa});assert.equal((await request(3,'monitoring/event',{...events[3],eventId:crypto.randomUUID(),sequence:2})).status,403);
      const race=await Promise.all([call(clients[0],'faculty:end-session',{sessionId:sa}),request(2,'monitoring/event',{...events[2],grantId:grants[2].grantId,eventId:crypto.randomUUID(),sequence:1})]);assert.equal(race[0].ok,true);assert([200,410].includes(race[1].status));
      await ok(clients[0],'faculty:end-session',{sessionId:sa});assert.equal((await call(clients[2],'student:join-session',{sessionId:sa})).ok,false);
      const [[open]]=await db.execute('SELECT COUNT(*) n FROM session_connection_intervals i JOIN session_participants p ON p.id=i.participant_id WHERE p.session_id=? AND i.disconnected_at IS NULL',[sa]);assert.equal(open.n,0);
      const [[attendance]]=await db.execute("SELECT COUNT(*) n FROM attendance WHERE session_id=? AND (status='Not Joined' OR finalized_at IS NULL)",[sa]);assert.equal(attendance.n,0);
    });
    await check('08 logout and accelerated expiry revoke HTTP and socket access',async()=>{
      assert.equal((await request(3,'logout',{})).status,200);assert.equal((await request(3,'student/me')).status,401);
      await db.execute('UPDATE auth_sessions SET expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE user_id=?',[users[4].id]);
      assert.equal((await request(4,'monitoring/start',{sessionId:sb,consent:true})).status,401);
      for(let i=0;i<40&&clients[4].connected;i++)await new Promise(r=>setTimeout(r,50));assert.equal(clients[4].connected,false);
    });
    for(const s of sockets)s.disconnect();await realtime.close();realtime=null;
    await check('09 rollback removes every fixture and preserves original table counts',async()=>{await db.rollback();for(const t of tables){const [[r]]=await db.query('SELECT COUNT(*) n FROM `'+t+'`');assert.equal(r.n,before[t],t);}});
    console.log('E2E SUMMARY: '+checks.length+' passed, 0 failed; Chrome lifecycle is tested separately, not simulated here.');
  }finally{for(const s of sockets)s.disconnect();if(realtime)await realtime.close();if(server?.listening)await new Promise(r=>server.close(r));await db.rollback();db.release();await pool.end();}
})().catch(error=>{console.error('E2E FAIL:',error.code||error.message);console.error(error.stack?.split('\n').filter(l=>l.includes('end-to-end.cjs')).join('\n'));process.exitCode=1;});
