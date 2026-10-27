'use strict';
require('dotenv').config({path:require('node:path').join(__dirname,'..','.env'),quiet:true});
const assert=require('node:assert/strict'),crypto=require('node:crypto'),argon2=require('argon2');
const pool=require('../src/config/database'),{setup}=require('../src/index');
(async()=>{
  const db=await pool.getConnection();let server,limitedServer,failureServer;
  const original={login:process.env.AUTH_LOGIN_LIMIT,register:process.env.AUTH_REGISTER_LIMIT};
  try {
    const names=['users','faculty_profiles','student_profiles','classes','enrollments','sessions','attendance','session_participants','session_connection_intervals','activity_logs','auth_sessions'];
    const before={};for(const name of names){const [[row]]=await db.query('SELECT COUNT(*) AS count FROM `'+name+'`');before[name]=row.count;}
    await db.beginTransaction();

    const testPool={execute:(...args)=>db.execute(...args),query:(...args)=>db.query(...args),getConnection:async()=>({execute:(...args)=>db.execute(...args),beginTransaction:()=>db.query('SAVEPOINT auth_registration'),commit:()=>db.query('RELEASE SAVEPOINT auth_registration'),rollback:()=>db.query('ROLLBACK TO SAVEPOINT auth_registration'),release(){}})};
    process.env.AUTH_LOGIN_LIMIT='100';process.env.AUTH_REGISTER_LIMIT='100';
    const listen=async app=>{const s=app.listen(0,'127.0.0.1');await new Promise(resolve=>s.once('listening',resolve));return s;};
    server=await listen(setup({pool:testPool}).app);
    const request=async(path,body,token,target=server,method)=>{
      const res=await fetch('http://127.0.0.1:'+target.address().port+path,{method:method||(body===undefined?'GET':'POST'),headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
      const data=await res.json();const text=JSON.stringify(data);
      assert(!text.includes('password_hash')&&!text.includes('$argon2')&&!text.includes('token_hash'));
      return {status:res.status,data,headers:res.headers};
    };
    const uid=crypto.randomUUID(),password='ApiTestPassword123!';
    const faculty={facultyId:'FAC-'+uid,fullName:'QA Faculty',department:'College of Computer and Sciences',academicPosition:'Instructor',email:'faculty-'+uid+'@example.edu',password};
    const student={studentId:'00-'+uid,fullName:'QA Student',program:'BSIT',yearLevel:4,section:'BSIT 3-1',email:'student-'+uid+'@example.edu',password};
    const reg=(role,body)=>request('/api/auth/'+role+'/register',body);
    for(const [role,values,fields]of [['faculty',faculty,['facultyId','fullName','department','academicPosition','email','password']],['student',student,['studentId','fullName','program','yearLevel','section','email','password']]]){
      for(const field of fields){const copy={...values};delete copy[field];const result=await reg(role,copy);assert.equal(result.status,400);assert(result.data.errors[field]);}
      for(const extra of [{email:'invalid'},{password:'short'},{fullName:[]},{role:role==='faculty'?'student':'faculty'},{confirmPassword:'mismatch'}])assert.equal((await reg(role,{...values,...extra})).status,400);
      assert.equal((await reg(role,{...values,fullName:'x'.repeat(161)})).status,400);
      assert.equal((await reg(role,{...values,password:'x'.repeat(129)})).status,400);
    }
    assert.equal((await reg('student',{...student,yearLevel:5})).status,400);
    assert.equal((await reg('student',{...student,studentId:123})).status,400);
    assert.equal((await reg('faculty',{...faculty,academicPosition:'Administrator'})).status,400);
    const f=await reg('faculty',{...faculty,fullName:'  QA Faculty  ',email:faculty.email.toUpperCase()});assert.equal(f.status,201);assert.equal(f.data.data.user.role,'faculty');assert.equal(f.data.data.user.fullName,'QA Faculty');
    const s=await reg('student',student);assert.equal(s.status,201);assert.equal(s.data.data.user.studentId,student.studentId);assert.equal(s.data.data.user.yearLevel,4);
    for(const [role,values,idKey]of [['faculty',faculty,'facultyId'],['student',student,'studentId']]){
      assert.equal((await reg(role,{...values,[idKey]:values[idKey]+'-different'})).status,409);
      const duplicateEmail=role+'-rollback-'+uid+'@example.edu';
      assert.equal((await reg(role,{...values,email:duplicateEmail})).status,409);
      const [[count]]=await db.execute('SELECT COUNT(*) AS count FROM users WHERE email=?',[duplicateEmail]);assert.equal(count.count,0,'Profile insert failure must roll back its user');
    }
    const [stored]=await db.execute('SELECT password_hash FROM users WHERE id IN (?,?)',[f.data.data.user.id,s.data.data.user.id]);
    assert(stored.every(row=>row.password_hash.startsWith('$argon2id$')));assert.notEqual(stored[0].password_hash,stored[1].password_hash);for(const row of stored)assert(await argon2.verify(row.password_hash,password));
    console.log('PASS: required fields, types, lengths/values, normalized email/name, fixed roles, duplicate accounts, atomic rollback and salted Argon2id storage.');
    const login=values=>request('/api/auth/login',{email:values.email,password:values.password});
    const fl=await login(faculty),sl=await login(student);assert.equal(fl.status,200);assert.equal(sl.status,200);
    const ft=fl.data.data.accessToken,st=sl.data.data.accessToken;assert.equal(ft.length,64);assert.notEqual(ft,st);assert.equal(fl.data.data.expiresIn,900);
    const [sessionRows]=await db.execute('SELECT HEX(token_hash) AS digest FROM auth_sessions WHERE user_id=?',[f.data.data.user.id]);assert.equal(sessionRows[0].digest.toLowerCase(),crypto.createHash('sha256').update(ft).digest('hex'));assert(!sessionRows[0].digest.toLowerCase().includes(ft));
    const wrong=await login({...faculty,password:'wrongpass'}),unknown=await login({...faculty,email:'unknown-'+uid+'@example.edu'});assert.equal(wrong.status,401);assert.deepEqual(wrong.data,unknown.data);
    for(const invalid of [undefined,'invalid','0'.repeat(64),ft.slice(0,63)+(ft.endsWith('a')?'b':'a')])assert.equal((await request('/api/auth/me',undefined,invalid)).status,401);
    assert.equal((await request('/api/auth/me?userId='+f.data.data.user.id,undefined,st)).status,400,'Unexpected identity query is rejected');
    const fm=await request('/api/auth/me',undefined,ft),sm=await request('/api/auth/me',undefined,st);
    assert.equal(fm.status,200);assert.equal(fm.data.data.user.facultyId,faculty.facultyId);assert.equal(sm.data.data.user.studentId,student.studentId);assert.equal(sm.data.data.user.id,s.data.data.user.id);assert.equal(fm.headers.get('cache-control'),'no-store');
    for(const [path,token,status]of [['faculty',ft,200],['faculty',st,403],['student',st,200],['student',ft,403]])assert.equal((await request('/api/auth/'+path+'/me',undefined,token)).status,status);
    assert.equal((await request('/api/auth/logout',{},ft)).status,200);assert.equal((await request('/api/auth/me',undefined,ft)).status,401);assert.equal((await request('/api/auth/logout',{},ft)).status,401);assert.equal((await request('/api/auth/me',undefined,st)).status,200);
    await db.execute('UPDATE auth_sessions SET expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE token_hash=?',[crypto.createHash('sha256').update(st).digest()]);assert.equal((await request('/api/auth/me',undefined,st)).status,401);
    console.log('PASS: both-role login, generic bad credentials, missing/invalid/tampered/expired bearer sessions, private profile retrieval, role authorization and immediate logout revocation.');
    const origin=process.env.CLIENT_ORIGIN.split(',')[0].trim(),websiteHeaders={'Content-Type':'application/json','Origin':origin,'X-Classence-Client':'faculty-web'};
    let response=await fetch('http://127.0.0.1:'+server.address().port+'/api/auth/login',{method:'POST',headers:websiteHeaders,body:JSON.stringify({email:faculty.email,password})});
    assert.equal(response.status,200);const cookieResponse=await response.json();assert.equal(cookieResponse.data.accessToken,undefined);
    const setCookie=response.headers.get('set-cookie');assert(setCookie.includes('HttpOnly'));assert(setCookie.includes('SameSite=Strict'));const cookieValue=setCookie.split(';')[0];
    response=await fetch('http://127.0.0.1:'+server.address().port+'/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json','Cookie':cookieValue},body:'{}'});assert.equal(response.status,403);
    response=await fetch('http://127.0.0.1:'+server.address().port+'/api/auth/faculty/me',{headers:{Cookie:cookieValue}});assert.equal(response.status,200);
    response=await fetch('http://127.0.0.1:'+server.address().port+'/api/auth/logout',{method:'POST',headers:{...websiteHeaders,Cookie:cookieValue},body:'{}'});assert.equal(response.status,200);assert(response.headers.get('set-cookie').includes('Expires='));
    response=await fetch('http://127.0.0.1:'+server.address().port+'/api/auth/me',{headers:{Cookie:cookieValue}});assert.equal(response.status,401);
    console.log('PASS: same-session HttpOnly cookie transport, no token in website response, CSRF origin/header checks and cookie logout revocation.');
    process.env.AUTH_LOGIN_LIMIT='2';process.env.AUTH_REGISTER_LIMIT='2';limitedServer=await listen(setup({pool:testPool}).app);
    for(let i=0;i<2;i++)assert.equal((await request('/api/auth/login',{email:faculty.email,password:'incorrect'},undefined,limitedServer)).status,401);
    assert.equal((await request('/api/auth/login',{email:faculty.email,password},undefined,limitedServer)).status,429);
    for(let i=0;i<2;i++)assert.equal((await request('/api/auth/student/register',{},undefined,limitedServer)).status,400);
    assert.equal((await request('/api/auth/faculty/register',{},undefined,limitedServer)).status,429);
    const disconnected={execute:async()=>{throw Object.assign(new Error('private database details'),{code:'ECONNREFUSED'});}};
    failureServer=await listen(setup({pool:disconnected}).app);const failed=await request('/api/auth/login',{email:faculty.email,password},undefined,failureServer);assert.equal(failed.status,503);assert(!JSON.stringify(failed.data).includes('private'));
    assert.equal((await request('/api/health')).status,200);assert.equal((await request('/api/health/database')).status,200);
    console.log('PASS: login/registration throttling, safe database-unavailable responses and original health endpoints.');
    await db.rollback();for(const name of names){const [[row]]=await db.query('SELECT COUNT(*) AS count FROM `'+name+'`');assert.equal(row.count,before[name]);}
    console.log('PASS: all authentication fixtures rolled back; pre-existing table counts preserved.');
  } finally {
    for(const s of [server,limitedServer,failureServer])if(s)await new Promise(resolve=>s.close(resolve));
    await db.rollback();db.release();process.env.AUTH_LOGIN_LIMIT=original.login;process.env.AUTH_REGISTER_LIMIT=original.register;await pool.end();
  }
})().catch(error=>{console.error('Authentication tests failed:',error.code||error.message);process.exitCode=1;});
