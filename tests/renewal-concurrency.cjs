'use strict';
require('dotenv').config({path:require('node:path').join(__dirname,'../.env'),quiet:true});
const assert=require('node:assert/strict'),crypto=require('node:crypto'),pool=require('../src/config/database'),{createAuthService}=require('../src/services/authService');
(async()=>{const auth=createAuthService(pool,900),uid=crypto.randomUUID(),email='renewal-locks-'+uid+'@example.edu',password='ParallelRefresh123!';let user;
 try{
  user=await auth.register('student',{email,password,fullName:'Disposable Concurrent Renewal',studentId:'S-'+uid,program:'BSIT',yearLevel:3,section:'BSIT 3-1'});
  const first=await auth.login({email,password},true),id=crypto.randomUUID();

  const values=await Promise.all([auth.refresh(first.refreshToken,id,'student'),auth.refresh(first.refreshToken,id,'student')]);assert(values[0].refreshToken===values[1].refreshToken,'Exactly one successor must be issued');
  const [[rows]]=await pool.execute('SELECT COUNT(*) n FROM refresh_credentials r JOIN session_families f ON f.id=r.family_id WHERE f.auth_session_id=? AND r.used_at IS NULL',[first.sessionId]);assert.equal(rows.n,1);
  console.log('PASS CONCURRENCY: independent MySQL connections serialize same-request renewal into one successor.');
  const next=values[0],raced=await Promise.allSettled([auth.refresh(next.refreshToken,crypto.randomUUID(),'student'),auth.refresh(next.refreshToken,crypto.randomUUID(),'student')]);assert.equal(raced.filter(r=>r.status==='fulfilled').length,1);assert.equal(raced.filter(r=>r.status==='rejected'&&r.reason.status===401).length,1);const issued=raced.find(r=>r.status==='fulfilled').value;await assert.rejects(()=>auth.authenticate(issued.accessToken),e=>e.status===401);
  console.log('PASS CONCURRENCY: distinct request IDs using one consumed credential revoke the family; no authorized successor survives replay.');
  const independent=await auth.login({email,password},true),original=await auth.login({email,password},true),requestId=crypto.randomUUID();await auth.refresh(original.refreshToken,requestId,'student');
  await pool.execute('UPDATE refresh_credentials SET used_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 31 SECOND) WHERE credential_hash=?',[crypto.createHash('sha256').update(original.refreshToken).digest()]);await assert.rejects(()=>auth.refresh(original.refreshToken,requestId,'student'),e=>e.status===401);await auth.authenticate(independent.accessToken);
  console.log('PASS CONCURRENCY: retry recovery is limited to 30 seconds; expired recovery revokes only the affected family.');
  const {spawnSync}=require('node:child_process');const code="const fs=require('node:fs'),read=fs.readFileSync;fs.readFileSync=function(file,...args){const result=read.call(this,file,...args);return String(file).endsWith('005_secure_sessions.sql')?result+'\\n-- simulated checksum mismatch':result;};require('./database/migrate');";
  const child=spawnSync(process.execPath,['-e',code],{cwd:require('node:path').resolve(__dirname,'..'),encoding:'utf8',windowsHide:true});assert.equal(child.status,1);assert((child.stdout+child.stderr).includes('Applied migration checksum differs'));
  console.log('PASS MIGRATION: simulated checksum mismatch rejected before new DDL; no migration file edited.');
 }finally{
  if(user){const db=await pool.getConnection();try{await db.beginTransaction();const [[owned]]=await db.execute('SELECT email FROM users WHERE id=? FOR UPDATE',[user.id]);assert.equal(owned.email,email,'Cleanup restricted to disposable UUID account');await db.execute('DELETE e FROM session_security_events e JOIN session_families f ON f.id=e.family_id WHERE f.user_id=?',[user.id]);await db.execute('DELETE r FROM refresh_credentials r JOIN session_families f ON f.id=r.family_id WHERE f.user_id=?',[user.id]);await db.execute('DELETE FROM session_families WHERE user_id=?',[user.id]);await db.execute('DELETE FROM auth_sessions WHERE user_id=?',[user.id]);await db.execute('DELETE FROM student_profiles WHERE user_id=?',[user.id]);await db.execute('DELETE FROM users WHERE id=? AND email=?',[user.id,email]);await db.commit();console.log('PASS CLEANUP: only this test\'s disposable account and session records removed.');}catch(e){await db.rollback();throw e;}finally{db.release();}}
  await pool.end();
 }
})().catch(e=>{console.error('Concurrent renewal verification failed:',e.code||String(e.message).replace(/\b[a-f0-9]{64}\b/gi,'[redacted]'));process.exitCode=1;});
