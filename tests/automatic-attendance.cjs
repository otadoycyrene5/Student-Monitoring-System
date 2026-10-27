'use strict';
require('dotenv').config({path:require('node:path').join(__dirname,'../.env'),quiet:true});
const assert=require('node:assert/strict'),crypto=require('node:crypto'),pool=require('../src/config/database');
const {createAuthService}=require('../src/services/authService'),{createLiveService}=require('../src/services/liveService'),automatic=require('../src/services/automaticAttendance'),activity=require('../src/services/meetActivity');
(async()=>{
 const db=await pool.getConnection(),tables=['users','faculty_profiles','student_profiles','auth_sessions','classes','enrollments','sessions','attendance','session_participants','session_connection_intervals','activity_logs','attendance_audit'],before={};
 try{
  for(const t of tables){const [[r]]=await db.query('SELECT COUNT(*) n FROM '+t);before[t]=r.n;}await db.beginTransaction();
  const transactional={execute:(...args)=>db.execute(...args),query:(...args)=>db.query(...args),getConnection:async()=>({execute:(...args)=>db.execute(...args),query:(...args)=>db.query(...args),beginTransaction:()=>db.query('SAVEPOINT automatic_work'),commit:()=>db.query('RELEASE SAVEPOINT automatic_work'),rollback:()=>db.query('ROLLBACK TO SAVEPOINT automatic_work'),release(){}})};
  const uid=crypto.randomUUID(),auth=createAuthService(transactional,900),who=[];
  for(let n=0;n<6;n++){const role=n?'student':'faculty',u=await auth.register(role,{email:'automatic-'+n+'-'+uid+'@example.edu',password:'Automatic123!Secure',fullName:'Automatic Person '+n,facultyId:'F-'+uid,department:'Computing',academicPosition:'Instructor',studentId:'S-'+n+'-'+uid,program:'BSIT',yearLevel:3,section:'BSIT 3-1'});who.push({role,userId:String(u.id)});}
  let clock=new Date(Date.now()+1000);const stamp=()=>"CAST('"+clock.toISOString().replace('T',' ').replace('Z','')+"' AS DATETIME(3))";
  const execute=(sql,values)=>db.execute(sql.replaceAll('UTC_TIMESTAMP(3)',stamp()),values);
  const timed={...transactional,execute,getConnection:async()=>({...await transactional.getConnection(),execute})},live=createLiveService(timed),c=await live.create(who[0],{name:'Automatic Rules',section:'BSIT 3-1',meet:'https://meet.google.com/abc-defg-hij'});
  for(const student of who.slice(1))await live.enroll(student,{code:c.code});
  const s=await live.start(who[0],c.classId),began=+clock;
  for(const [index,offset]of [300000,899000,900000,1200000].entries()){
   clock=new Date(began+offset);await live.join(who[index+1],s.sessionId);
   const [[r]]=await db.execute('SELECT a.status,a.finalized_at,p.first_joined_at FROM attendance a JOIN session_participants p ON p.session_id=a.session_id AND p.student_user_id=a.student_user_id WHERE a.session_id=? AND a.student_user_id=?',[s.sessionId,who[index+1].userId]);
   assert.equal(r.status,index<2?'Present':'Late');assert.equal(+r.first_joined_at,began+offset);assert.equal(r.finalized_at,null);
   console.log('PASS AUTOMATIC: first valid join at '+offset/1000+' seconds = '+r.status);
  }
  const [[pending]]=await db.execute('SELECT status,finalized_at FROM attendance WHERE session_id=? AND student_user_id=?',[s.sessionId,who[5].userId]);assert.equal(pending.status,'Not Joined');assert.equal(pending.finalized_at,null);
  await live.offline(who[1],s.sessionId,true);await live.join(who[1],s.sessionId);await live.join(who[1],s.sessionId);
  const [[first]]=await db.execute('SELECT first_joined_at FROM session_participants WHERE session_id=? AND student_user_id=?',[s.sessionId,who[1].userId]);assert.equal(+first.first_joined_at,began+300000);
  const recovered=createLiveService(timed,{reconcileClassIds:[c.classId]});await recovered.reconcile();await recovered.join(who[1],s.sessionId);
  const [[restored]]=await db.execute('SELECT a.status,p.first_joined_at FROM attendance a JOIN session_participants p ON p.session_id=a.session_id AND p.student_user_id=a.student_user_id WHERE a.session_id=? AND a.student_user_id=?',[s.sessionId,who[1].userId]);assert.equal(restored.status,'Present');assert.equal(+restored.first_joined_at,+first.first_joined_at);
  clock=new Date(began+1260000);await live.end(who[0],s.sessionId);
  const records=require('../src/services/facultyRecordsService')(timed);let record=await records.attendance(who[0],s.sessionId);
  assert.deepEqual(record.rows.map(r=>r.status),['Present','Present','Late','Late','Absent']);assert(record.finalized);assert(record.rows.every(r=>r.finalizedAt));assert(record.audit.every(a=>a.changes.source===automatic.source&&a.changes.actor==='system'));
  const audits=record.audit.length;await live.end(who[0],s.sessionId);assert.equal((await records.attendance(who[0],s.sessionId)).audit.length,audits);
  const totals=(await records.sessions(who[0],c.classId))[0];assert.deepEqual([totals.presentCount,totals.lateCount,totals.absentCount].map(Number),[2,2,1]);
  console.log('PASS AUTOMATIC: no live absence; end persists/finalizes 2 Present, 2 Late, 1 Absent; rejoin/recovery preserve first join; repeated events are idempotent.');
  await assert.rejects(records.save(who[0],s.sessionId,{version:record.version,changes:[{studentId:who[1].userId,status:'Absent'}]}),e=>e.status===409);
  record=await records.reopen(who[0],s.sessionId,{version:record.version,reason:'Explicit audited correction test.'});assert(record.correctionOpen);
  await automatic.apply({execute},s.sessionId);assert((await records.attendance(who[0],s.sessionId)).correctionOpen);
  record=await records.save(who[0],s.sessionId,{version:record.version,changes:[{studentId:who[1].userId,status:'Late'}]});record=await records.finalize(who[0],s.sessionId,{version:record.version});
  await automatic.apply({execute},s.sessionId);const preserved=await records.attendance(who[0],s.sessionId);assert.equal(preserved.version,record.version);assert.equal(preserved.rows[0].status,'Late');
  console.log('PASS AUTOMATIC: finalized history is protected; explicit reasoned correction stays audited and is not recalculated.');
  const [legacy]=await db.execute("INSERT INTO sessions(class_id,status,started_at,ended_at) VALUES (?,'Completed',?,?)",[c.classId,new Date(began),new Date(began+1260000)]);
  await db.execute("INSERT INTO attendance(session_id,student_user_id,status) VALUES (?,?,'Not Joined')",[legacy.insertId,who[1].userId]);
  await db.execute("INSERT INTO session_participants(session_id,student_user_id,first_joined_at,last_joined_at,participation_status,connection_status) VALUES (?,?,?,?,'Left','Offline')",[legacy.insertId,who[1].userId,new Date(began+300000),new Date(began+300000)]);
  await recovered.reconcile();const migrated=await records.attendance(who[0],String(legacy.insertId));assert(migrated.finalized);assert.equal(migrated.rows[0].status,'Present');assert(migrated.audit.some(a=>a.changes.source===automatic.source));
  const again=await records.attendance(who[0],s.sessionId);assert.equal(again.version,record.version);assert.equal(again.rows[0].status,'Late');
  console.log('PASS AUTOMATIC: startup reconciles unfinished completed attendance with audit snapshots, and leaves finalized history unchanged.');
  const expiry=new Date(began+3600000).toISOString(),since=new Date(began).toISOString(),m={health:'RECENT',tabState:'MEET_TAB_NOT_SELECTED',lastReportAt:new Date(began+299000).toISOString(),unfocusedSince:since,expiresAt:expiry};
  assert.equal(activity.classify(m,began+299999),'On Another Tab');assert.equal(activity.classify(m,began+300000),'Inactive');
  assert.equal(activity.classify({...m,tabState:'MEET_TAB_SELECTED'},began+300000),'Active');
  assert.equal(activity.classify(m,began+400000),'Unknown');
  for(const health of ['STOPPED','WITHDRAWN','NOT_STARTED','STATUS_UNKNOWN','AUTH_EXPIRED'])assert.equal(activity.classify({...m,health},began+300000),'Unknown');
  assert.equal(activity.classify({...m,tabState:'MEET_TAB_CLOSED'},began+300000),'Unknown');
  const previous={tab_state:m.tabState,last_report_at:m.lastReportAt,observation:{unfocusedSince:since}};
  assert.equal(activity.nextUnfocusedSince(previous,m.tabState,began+300000,75000),since);
  assert.equal(activity.nextUnfocusedSince(previous,m.tabState,began+400000,75000),new Date(began+400000).toISOString());
  assert.equal(activity.nextUnfocusedSince(previous,'MEET_TAB_SELECTED',began+300000,75000),null);
  assert.equal(activity.nextUnfocusedSince(previous,m.tabState,began+300000,75000,true),null);
  assert.equal(activity.nextUnfocusedSince(previous,m.tabState,began+300000,75000,false,began+299500),new Date(began+300000).toISOString());
  console.log('PASS ACTIVITY: 4:59 On Another Tab; exactly 5:00 Inactive; focus resets; stale/withdrawn/stopped/missing/delayed states break the timer; popup connection is not an input.');
  await db.rollback();for(const t of tables){const [[r]]=await db.query('SELECT COUNT(*) n FROM '+t);assert.equal(r.n,before[t],t+' cleanup');}console.log('PASS AUTOMATIC: real MySQL fixtures rolled back; existing records preserved.');
 }finally{await db.rollback();db.release();await pool.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
