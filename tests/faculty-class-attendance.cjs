'use strict';
require('dotenv').config({path:require('node:path').join(__dirname,'../.env'),quiet:true});
const assert=require('node:assert/strict'),crypto=require('node:crypto'),http=require('node:http'),pool=require('../src/config/database');
const {setup}=require('../src/index'),{attachRealtime}=require('../src/realtime'),{createAuthService}=require('../src/services/authService'),{createLiveService}=require('../src/services/liveService'),{createMeetMonitoringService}=require('../src/services/meetMonitoringService');
(async()=>{
 const db=await pool.getConnection(),tables=['users','faculty_profiles','student_profiles','auth_sessions','classes','enrollments','sessions','attendance','session_participants','session_connection_intervals','activity_logs','meet_monitoring','attendance_audit'],before={};let server,realtime,base;let passed=0;
 const test=async(name,work)=>{await work();console.log('PASS STEP9: '+name);passed++;};
 try{
  for(const t of tables){const [[r]]=await db.query('SELECT COUNT(*) n FROM '+t);before[t]=r.n;}await db.beginTransaction();
  const testPool={execute:(...a)=>db.execute(...a),query:(...a)=>db.query(...a),getConnection:async()=>({execute:(...a)=>db.execute(...a),query:(...a)=>db.query(...a),beginTransaction:()=>db.query('SAVEPOINT records_test'),commit:()=>db.query('RELEASE SAVEPOINT records_test'),rollback:()=>db.query('ROLLBACK TO SAVEPOINT records_test'),release(){}})};
  const uid=crypto.randomUUID(),password='Step9Integration123!',origin='http://127.0.0.1:5500';process.env.CLIENT_ORIGIN=origin;
  const auth=createAuthService(testPool,900),live=createLiveService(testPool),users=[],tokens=[],identities=[];
  for(let i=0;i<7;i++){const role=i<2?'faculty':'student',user=await auth.register(role,{email:'records-'+i+'-'+uid+'@example.edu',password,fullName:'Records Person '+i,facultyId:'F-'+i+'-'+uid,department:'Computing',academicPosition:'Instructor',studentId:'S-'+i+'-'+uid,program:'BSIT',yearLevel:3,section:'BSIT 3-1'});users.push(user);const login=await auth.login({email:user.email,password});tokens.push(login.accessToken);identities.push(await auth.authenticate(login.accessToken));}
  async function start(){const instance=setup({pool:testPool});server=http.createServer(instance.app);realtime=await attachRealtime(server,testPool,[origin],{lockName:'records_'+uid,reconcileClassIds:['18446744073709551615']});instance.app.locals.realtime=realtime;await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;}
  const request=async(n,path,method='GET',body)=>{const response=await fetch(base+'/api/auth/live/'+path,{method,headers:{'Content-Type':'application/json',...(n>=0?{Authorization:'Bearer '+tokens[n]}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();assert(!/password_hash|token_hash|sqlMessage/.test(JSON.stringify(data)));return {status:response.status,...data};};
  await start();let c,other,edited,session,record;
  await test('01 real class create/read and allowed partial update persist in MySQL',async()=>{
   c=(await request(0,'classes','POST',{name:'Records Class',section:'BSIT 3-1',meet:'https://meet.google.com/abc-defg-hij'})).data;
   other=await live.create(identities[1],{name:'Foreign Class',section:'BSIT 3-1',meet:'https://meet.google.com/xyz-abcd-efg'});
   for(const n of [2,3,4,5])await live.enroll(identities[n],{code:c.code});await live.enroll(identities[6],{code:other.code});
   const original=(await request(0,'classes/'+c.classId)).data;
   const result=await request(0,'classes/'+c.classId,'PATCH',{name:'Updated Records',section:'BSIT 3-2',meet:'https://meet.google.com/xyz-abcd-efg',version:original.version});assert.equal(result.status,200);edited=result.data;assert.equal(edited.code,c.code);
   const [[row]]=await db.execute('SELECT class_name,section,meet_link,class_code FROM classes WHERE id=?',[c.classId]);assert.equal(row.class_name,edited.name);assert.equal(row.meet_link,edited.meet);const [[count]]=await db.execute('SELECT COUNT(*) n FROM enrollments WHERE class_id=?',[c.classId]);assert.equal(count.n,4);
  });
  await test('02 class ownership, role, anonymous, whitelist, validation and stale edit rejection',async()=>{
   for(const n of [-1,1,2])assert.equal((await request(n,'classes/'+c.classId,'PATCH',{name:'Forbidden',version:edited.version})).status,n===-1?401:403);
   for(const extra of [{faculty_user_id:users[1].id},{code:'CL-AAAAAA'},{name:''},{meet:'https://example.com'}])assert.equal((await request(0,'classes/'+c.classId,'PATCH',{...extra,version:edited.version})).status,400);
   assert.equal((await request(0,'classes/'+c.classId,'PATCH',{name:'Stale',version:'0'.repeat(64)})).status,409);
  });
  await test('03 persistence across server restart and genuine reauthentication; live Meet retarget blocked',async()=>{
   await realtime.close();realtime=null;await start();const login=await auth.login({email:users[0].email,password});tokens[0]=login.accessToken;identities[0]=await auth.authenticate(login.accessToken);
   const restored=(await request(0,'classes/'+c.classId)).data;assert.equal(restored.name,'Updated Records');assert.equal(restored.section,'BSIT 3-2');assert.equal(restored.code,c.code);
   session=await live.start(identities[0],c.classId);assert.equal((await request(0,'classes/'+c.classId,'PATCH',{meet:'https://meet.google.com/abc-defg-hij',version:restored.version})).status,409);
   await live.join(identities[2],session.sessionId);
  });
  const path='sessions/';
  await test('04 complete eligible roster includes never-joined Students without duplicates',async()=>{
   const result=await request(0,path+session.sessionId+'/attendance');assert.equal(result.status,200);record=result.data;assert.equal(record.rows.length,4);assert.equal(record.rows.filter(r=>r.participation==='Not Joined').length,3);assert.equal(record.rows.filter(r=>r.status==='Present').length,1);
   const again=(await request(0,path+session.sessionId+'/attendance')).data;assert.equal(again.version,record.version);assert.equal(again.rows.length,4);
  });
  const endpoint=path+session.sessionId+'/attendance';
  await test('05 attendance read/write denies foreign Faculty, Students and anonymous requests',async()=>{
   for(const n of [1,2,-1]){assert.equal((await request(n,endpoint)).status,n===-1?401:403);assert.equal((await request(n,endpoint,'PATCH',{version:record.version,changes:[{studentId:String(users[2].id),status:'Present'}]})).status,n===-1?401:403);}
  });
  await test('06 invalid/outsider batches rollback, live Absent/finalization rejected',async()=>{
   for(const [studentId,status,expected]of [[String(users[2].id),'Attentive',400],[String(users[6].id),'Present',403],[String(users[2].id),'Absent',400]])assert.equal((await request(0,endpoint,'PATCH',{version:record.version,changes:[{studentId,status}]})).status,expected);
   assert.equal((await request(0,endpoint+'/finalize','POST',{version:record.version})).status,409);
   const current=(await request(0,endpoint)).data;assert.equal(current.version,record.version);assert.equal(current.rows.filter(r=>r.status==='Present').length,1);
  });
  await test('07 correction API and Meet metadata are independent; end automatically finalizes',async()=>{
   record=(await request(0,endpoint,'PATCH',{version:record.version,changes:[{studentId:String(users[2].id),status:'Late'}]})).data;
   const monitor=require('../src/services/meetMonitoringService').createMeetMonitoringService(testPool),grant=await monitor.start(identities[2],{sessionId:session.sessionId,consent:true});
   await monitor.event(identities[2],{sessionId:session.sessionId,grantId:grant.grantId,eventId:crypto.randomUUID(),sequence:1,eventType:'TAB_STATE',tabState:'MEET_TAB_SELECTED'});
   for(const [sequence,tabState] of [[2,'MEET_TAB_NOT_SELECTED'],[3,'MEET_TAB_NOT_SELECTED'],[4,'MEET_TAB_SELECTED'],[5,'MEET_TAB_NOT_SELECTED'],[6,'MEET_TAB_CLOSED']])await monitor.event(identities[2],{sessionId:session.sessionId,grantId:grant.grantId,eventId:crypto.randomUUID(),sequence,eventType:'TAB_STATE',tabState});
   await db.execute("UPDATE activity_logs SET event_details=JSON_REMOVE(event_details,'$.tabSwitch') WHERE session_id=? AND student_user_id=?",[session.sessionId,users[2].id]);
   let monitored=(await request(0,endpoint)).data;assert.equal(monitored.rows.find(row=>row.studentId===String(users[2].id)).tabSwitches,2);assert.equal(monitored.rows.find(row=>row.studentId===String(users[3].id)).tabSwitches,null);
   const [[attendance]]=await db.execute('SELECT status,finalized_at FROM attendance WHERE session_id=? AND student_user_id=?',[session.sessionId,users[2].id]);assert.equal(attendance.status,'Late');assert.equal(attendance.finalized_at,null);
   await live.end(identities[0],session.sessionId);record=(await request(0,endpoint)).data;assert.equal(record.finalized,true);assert.equal(record.rows.find(row=>row.studentId===String(users[2].id)).tabSwitches,2);assert.equal(record.rows.filter(r=>r.status==='Absent').length,3);const review=(await request(0,'classes/'+c.classId+'/sessions')).data.find(s=>s.id===session.sessionId);assert.equal(Number(review.finalizedCount),4);assert.equal(Number(review.presentCount),1);assert.equal(Number(review.unclassifiedCount),0);assert.equal(Number(review.attendanceCount),4);
  });

  await realtime.close();realtime=null;await start();
  await test('08 save all four statuses, finalize explicitly, reject silent finalized edits',async()=>{
   record=(await request(0,endpoint+'/reopen','POST',{version:record.version,reason:'Explicit audited correction after automatic finalization.'})).data;
   record=(await request(0,endpoint,'PATCH',{version:record.version,changes:['Present','Late','Absent','Not Joined'].map((status,i)=>({studentId:String(users[i+2].id),status}))})).data;
   assert.deepEqual(record.rows.map(r=>r.status).sort(),['Absent','Late','Not Joined','Present']);
   record=(await request(0,endpoint+'/finalize','POST',{version:record.version})).data;assert.equal(record.finalized,true);assert(record.rows.every(r=>r.finalizedAt&&Date.parse(r.finalizedAt)>=Date.parse(record.endedAt)));
   assert.equal((await request(0,endpoint,'PATCH',{version:record.version,changes:[{studentId:String(users[2].id),status:'Absent'}]})).status,409);
  });
  await test('09 explicit reasoned reopening, conflicting saves and immutable audit history',async()=>{
   assert.equal((await request(0,endpoint+'/reopen','POST',{version:record.version,reason:''})).status,400);
   record=(await request(0,endpoint+'/reopen','POST',{version:record.version,reason:'Faculty reviewed supporting records.'})).data;assert.equal(record.finalized,false);
   const version=record.version;const results=await Promise.all(['Present','Late'].map(status=>request(0,endpoint,'PATCH',{version,changes:[{studentId:String(users[5].id),status}]})));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);record=results.find(r=>r.status===200).data;
   record=(await request(0,endpoint+'/finalize','POST',{version:record.version})).data;assert(record.audit.some(a=>a.action==='Reopened'&&a.reason.includes('supporting records')));assert(record.audit.filter(a=>a.action==='Finalized').length===3);assert(record.audit.every(a=>String(a.facultyId)===String(users[0].id)));
  });
  await test('10 historical retrieval after reauthentication; preserved code/enrollment and no late enrollment backfill',async()=>{
   await live.enroll(identities[6],{code:c.code});const login=await auth.login({email:users[0].email,password});tokens[0]=login.accessToken;
   const historical=(await request(0,endpoint)).data;assert.equal(historical.finalized,true);assert.equal(historical.rows.length,4);assert.equal(historical.version,record.version);
   assert(historical.rows.every(r=>Object.hasOwn(r,'lastLeftAt')&&Number(r.connectedMs)>=0));
   const [intervals]=await db.execute('SELECT p.student_user_id AS studentId,COALESCE(SUM(GREATEST(0,TIMESTAMPDIFF(MICROSECOND,i.connected_at,COALESCE(i.disconnected_at,?)))),0)/1000 AS duration FROM session_participants p LEFT JOIN session_connection_intervals i ON i.participant_id=p.id WHERE p.session_id=? GROUP BY p.student_user_id',[historical.endedAt,session.sessionId]);
   for(const r of intervals)assert.equal(Number(historical.rows.find(s=>s.studentId===String(r.studentId)).connectedMs),Number(r.duration));
   const history=(await request(0,'classes/'+c.classId+'/sessions')).data;assert(history.some(s=>s.id===session.sessionId&&s.status==='Completed'));const totals=history.find(s=>s.id===session.sessionId);assert.equal(Number(totals.attendanceCount),historical.rows.length);assert.equal(Number(totals.finalizedCount),historical.rows.length);assert.equal(Number(totals.unclassifiedCount),historical.rows.filter(r=>r.status==='Not Joined').length);for(const [key,status]of [['presentCount','Present'],['lateCount','Late'],['absentCount','Absent']])assert.equal(Number(totals[key]),historical.rows.filter(r=>r.status===status).length);assert.equal((await request(0,'classes/'+c.classId)).data.code,c.code);
  });
  await realtime.close();realtime=null;await db.rollback();for(const t of tables){const [[r]]=await db.query('SELECT COUNT(*) n FROM '+t);assert.equal(r.n,before[t],t+' cleanup');}console.log('PASS STEP9: 11 all fixtures including audit rolled back; original records preserved.');passed++;
  console.log('STEP9 SUMMARY: '+passed+' named cases passed, 0 failed.');
 }finally{if(realtime)await realtime.close();if(server?.listening)await new Promise(r=>server.close(r));await db.rollback();db.release();await pool.end();}
})().catch(error=>{console.error('Step 9 failed:',error.code||error.message);console.error(error.stack?.split('\n').filter(l=>l.includes('faculty-class-attendance')).join('\n'));process.exitCode=1;});
