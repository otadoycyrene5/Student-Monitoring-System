'use strict';
const assert=require('node:assert/strict');
(async()=>{let f;try{
  f=await require('./privacy-fixture.cjs')();
  const request=async(n,body)=>{const response=await fetch(f.base+'/api/auth/student/me',{method:'PATCH',headers:{'Content-Type':'application/json',...(n>=0?{Authorization:'Bearer '+f.credentials[n].accessToken}:{})},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
  const before=await f.auth.profile(f.users[2].id),valid={fullName:'Student Profile Updated',email:'student-profile-'+f.uid+'@example.edu',program:'BS Computer Science',yearLevel:4,section:'BSCS 4-1'};
  const [[counts]]=await f.db.execute('SELECT (SELECT COUNT(*) FROM enrollments WHERE student_user_id=?) AS enrollments,(SELECT COUNT(*) FROM attendance WHERE student_user_id=?) AS attendance',[f.users[2].id,f.users[2].id]);
  const saved=await request(2,{...valid,fullName:'  '+valid.fullName+'  ',email:valid.email.toUpperCase(),program:'  '+valid.program+'  ',section:'  '+valid.section+'  '});
  assert.equal(saved.status,200);assert.deepEqual(saved.data.data.user,{...valid,id:before.id,studentId:before.studentId,role:'student'});assert.deepEqual(await f.auth.profile(f.users[2].id),{...valid,id:before.id,studentId:before.studentId,role:'student'});
  const [[after]]=await f.db.execute('SELECT (SELECT COUNT(*) FROM enrollments WHERE student_user_id=?) AS enrollments,(SELECT COUNT(*) FROM attendance WHERE student_user_id=?) AS attendance',[f.users[2].id,f.users[2].id]);assert.deepEqual(after,counts);
  for(const body of [{...valid,email:f.users[3].email},{...valid,email:'bad'},{...valid,fullName:' '},{...valid,program:'bad\nvalue'},{...valid,yearLevel:'5'},{...valid,section:' '},{...valid,studentId:'changed'},{...valid,role:'faculty'},{...valid,expectedUserId:f.users[3].id}])assert([400,409].includes((await request(2,body)).status));
  assert.equal((await request(-1,valid)).status,401);assert.equal((await request(0,valid)).status,403);
  const login=await f.auth.login({email:valid.email,password:f.password},true);assert.equal(login.user.id,before.id);assert.equal(login.user.studentId,before.studentId);assert.equal(login.user.role,'student');
  console.log('PASS STUDENT PROFILE: authenticated Students update only allowed self fields; duplicate and injected values are rejected; student identity, enrollments and attendance remain intact.');
}finally{if(f)await f.close();}})().catch(error=>{console.error('Student profile test failed:',error.stack||error.message);process.exitCode=1;});
