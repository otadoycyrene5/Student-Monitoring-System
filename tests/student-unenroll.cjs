'use strict';
const assert=require('node:assert/strict');
(async()=>{let f;try{
  f=await require('./privacy-fixture.cjs')();
  const request=async(n,classId)=>{const response=await fetch(f.base+'/api/auth/live/classes/'+encodeURIComponent(classId)+'/enrollment',{method:'DELETE',headers:{Authorization:'Bearer '+f.credentials[n].accessToken}});return {status:response.status,data:await response.json()};};
  await assert.rejects(f.live.unenroll(f.identities[2],f.cls.classId),error=>error.status===409&&/Leave the active session/.test(error.message));
  const [[before]]=await f.db.execute('SELECT id,status FROM enrollments WHERE class_id=? AND student_user_id=?',[f.cls.classId,f.users[2].id]);
  await f.live.offline(f.identities[2],f.session.sessionId,true);
  const result=await request(2,f.cls.classId);assert.equal(result.status,200);assert.equal(result.data.data.classId,String(f.cls.classId));
  const [[after]]=await f.db.execute('SELECT id,status,unenrolled_at FROM enrollments WHERE class_id=? AND student_user_id=?',[f.cls.classId,f.users[2].id]);assert.equal(after.id,before.id);assert.equal(after.status,'Unenrolled');assert(after.unenrolled_at);
  const snapshot=await f.live.snapshot(f.identities[2]);assert.equal(snapshot.classes.length,0);
  const other=await f.live.snapshot(f.identities[3]);assert.equal(other.classes.length,1);
  const faculty=await f.live.snapshot(f.identities[0]);assert(!faculty.classes[0].students.some(student=>student.id===String(f.users[2].id)));
  const [[attendance]]=await f.db.execute('SELECT COUNT(*) n FROM attendance WHERE session_id=? AND student_user_id=?',[f.session.sessionId,f.users[2].id]);const [[logs]]=await f.db.execute('SELECT COUNT(*) n FROM activity_logs WHERE session_id=? AND student_user_id=?',[f.session.sessionId,f.users[2].id]);assert(attendance.n>0&&logs.n>0);
  assert.equal((await request(2,f.cls.classId)).status,404);
  await assert.rejects(f.live.unenroll(f.identities[0],f.cls.classId),error=>error.status===403);
  await f.live.enroll(f.identities[2],{code:f.cls.code});const [[reenrolled]]=await f.db.execute('SELECT id,status FROM enrollments WHERE class_id=? AND student_user_id=?',[f.cls.classId,f.users[2].id]);assert.equal(reenrolled.id,before.id);assert.equal(reenrolled.status,'Active');const [[count]]=await f.db.execute('SELECT COUNT(*) n FROM enrollments WHERE class_id=? AND student_user_id=?',[f.cls.classId,f.users[2].id]);assert.equal(count.n,1);assert.equal((await f.live.snapshot(f.identities[2])).classes.length,1);
  console.log('PASS UNENROLL: active participation blocks removal; authenticated Student can unenroll only self; history remains; other Students and class stay unchanged; re-enrollment reactivates one preserved enrollment.');
}finally{if(f)await f.close();}})().catch(error=>{console.error(error.stack);process.exitCode=1;});
