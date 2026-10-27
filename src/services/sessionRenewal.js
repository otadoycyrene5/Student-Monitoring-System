'use strict';
const crypto=require('node:crypto'),settings=require('../config/sessions');
const digest=value=>crypto.createHash('sha256').update(value).digest(),random=()=>crypto.randomBytes(32).toString('hex');
const denied=()=>Object.assign(new Error('Session renewal required a new login.'),{status:401,public:true});
const valid=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

function seal(value,key){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',digest('classence-refresh-retry:'+key),iv);const data=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]);}
function unseal(value,key){const data=Buffer.from(value),cipher=crypto.createDecipheriv('aes-256-gcm',digest('classence-refresh-retry:'+key),data.subarray(0,12));cipher.setAuthTag(data.subarray(12,28));return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]).toString());}
module.exports=(pool,lifetime,profile)=>{
 const config=settings();
 const renewals=new Map();let lastSweep=0;
 function renewalBudget(family,now){if(now-lastSweep>60000){for(const [key,bucket]of renewals)if(now-bucket.at>=60000)renewals.delete(key);lastSweep=now;}const key=String(family);let bucket=renewals.get(key);if(!bucket||now-bucket.at>=60000){bucket={at:now,count:0};renewals.set(key,bucket);}if(++bucket.count>30)throw Object.assign(new Error('Too many renewal attempts. Try again shortly.'),{status:429,public:true,retryAfter:Math.max(1,Math.ceil((bucket.at+60000-now)/1000))});}
 async function transaction(work){const db=await pool.getConnection();try{await db.beginTransaction();const r=await work(db);await db.commit();return r;}catch(e){await db.rollback();throw e;}finally{db.release();}}
 async function event(db,id,type){await db.execute('INSERT INTO session_security_events(family_id,event_type,occurred_at) VALUES (?,?,UTC_TIMESTAMP(3))',[id,type]);}
 async function revoke(db,f,type){await db.execute('UPDATE session_families SET revoked_at=UTC_TIMESTAMP(3),revocation_reason=? WHERE id=? AND revoked_at IS NULL',[type,f.id]);await db.execute('UPDATE auth_sessions SET revoked_at=UTC_TIMESTAMP(3) WHERE id=? AND revoked_at IS NULL',[f.auth_session_id]);await db.execute("UPDATE meet_monitoring SET consent_active=0,stopped_at=UTC_TIMESTAMP(3),stop_reason='AUTH_REVOKED' WHERE auth_session_id=? AND consent_active=1",[f.auth_session_id]);await event(db,f.id,type);}
 async function issue(user,passwordHash){return transaction(async db=>{
  const now=Date.now(),accessToken=random(),refreshToken=random(),absolute=new Date(now+config.absolute*1000),idle=new Date(Math.min(+absolute,now+config.idle*1000)),expires=new Date(Math.min(+idle,now+lifetime*1000));
  const [a]=await db.execute('INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES (?,?,?)',[user.id,digest(accessToken),expires]);
  const [f]=await db.execute('INSERT INTO session_families(auth_session_id,user_id,role,password_fingerprint,created_at,last_renewed_at,idle_expires_at,absolute_expires_at) VALUES (?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),?,?)',[a.insertId,user.id,user.role,digest(passwordHash),idle,absolute]);
  await db.execute('INSERT INTO refresh_credentials(family_id,credential_hash,created_at) VALUES (?,?,UTC_TIMESTAMP(3))',[f.insertId,digest(refreshToken)]);await event(db,f.insertId,'Login');
  return {user,accessToken,refreshToken,tokenType:'Bearer',expiresIn:Math.max(0,Math.floor((+expires-now)/1000)),expiresAt:expires.toISOString(),absoluteExpiresAt:absolute.toISOString(),idleExpiresAt:idle.toISOString(),sessionId:String(a.insertId)};
 });}
 async function refresh(token,requestId,expectedRole){if(!valid(token)||typeof requestId!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))throw denied();
  const result=await transaction(async db=>{
   const [[found]]=await db.execute('SELECT family_id FROM refresh_credentials WHERE credential_hash=?',[digest(token)]);if(!found)return null;
   const [[f]]=await db.execute('SELECT f.*,a.revoked_at AS access_revoked,u.password_hash,u.role AS current_role FROM session_families f JOIN auth_sessions a ON a.id=f.auth_session_id JOIN users u ON u.id=f.user_id WHERE f.id=? FOR UPDATE',[found.family_id]);
   const [[r]]=await db.execute('SELECT * FROM refresh_credentials WHERE credential_hash=? FOR UPDATE',[digest(token)]);
   if(!f||f.revoked_at||f.access_revoked)return null;
   if(expectedRole&&expectedRole!==f.role)return null;
   if(f.role!==f.current_role||!digest(f.password_hash).equals(f.password_fingerprint)){await revoke(db,f,'AccountChanged');return null;}
   const [[clock]]=await db.execute('SELECT UTC_TIMESTAMP(3) AS now');
   const now=+new Date(clock.now);if(+new Date(f.absolute_expires_at)<=now||+new Date(f.idle_expires_at)<=now){await revoke(db,f,'Expired');return null;}
   if(r.used_at){
    if(r.request_id===requestId&&now>=+new Date(r.used_at)&&now-+new Date(r.used_at)<=30000&&r.retry_envelope){

     const [[next]]=await db.execute('SELECT used_at FROM refresh_credentials WHERE family_id=? ORDER BY id DESC LIMIT 1',[f.id]);
     if(!next.used_at){const recovered=unseal(r.retry_envelope,token);if(Date.parse(recovered.expiresAt)>now)return recovered;}
    }
    await revoke(db,f,'Replay');return null;
   }
   renewalBudget(f.id,now);
   const accessToken=random(),refreshToken=random(),idle=new Date(Math.min(+new Date(f.absolute_expires_at),now+config.idle*1000)),expires=new Date(Math.min(+idle,now+lifetime*1000)),user=await profile(f.user_id,db);
   const value={user,accessToken,refreshToken,tokenType:'Bearer',expiresIn:Math.floor((+expires-now)/1000),expiresAt:expires.toISOString(),absoluteExpiresAt:new Date(f.absolute_expires_at).toISOString(),idleExpiresAt:idle.toISOString(),sessionId:String(f.auth_session_id)};
   await db.execute('UPDATE auth_sessions SET token_hash=?,expires_at=? WHERE id=?',[digest(accessToken),expires,f.auth_session_id]);
   await db.execute('UPDATE session_families SET last_renewed_at=UTC_TIMESTAMP(3),idle_expires_at=? WHERE id=?',[idle,f.id]);
   await db.execute('UPDATE refresh_credentials SET used_at=UTC_TIMESTAMP(3),request_id=?,retry_envelope=? WHERE id=?',[requestId,seal(value,token),r.id]);
   await db.execute('INSERT INTO refresh_credentials(family_id,credential_hash,created_at) VALUES (?,?,UTC_TIMESTAMP(3))',[f.id,digest(refreshToken)]);

   await db.execute('UPDATE refresh_credentials SET retry_envelope=NULL WHERE family_id=? AND id<>?',[f.id,r.id]);await event(db,f.id,'Renewed');return value;
  });if(!result)throw denied();return result;
 }
 async function logout(identity){await transaction(async db=>{const [[f]]=await db.execute('SELECT * FROM session_families WHERE auth_session_id=? FOR UPDATE',[identity.sessionId]);if(f&&!f.revoked_at)await revoke(db,f,'Logout');else await db.execute('UPDATE auth_sessions SET revoked_at=UTC_TIMESTAMP(3) WHERE id=? AND user_id=?',[identity.sessionId,identity.userId]);});}
 async function logoutRefresh(token){if(!valid(token))throw denied();const result=await transaction(async db=>{const [[r]]=await db.execute('SELECT family_id FROM refresh_credentials WHERE credential_hash=?',[digest(token)]);if(!r)return null;const [[f]]=await db.execute('SELECT * FROM session_families WHERE id=? FOR UPDATE',[r.family_id]);if(!f.revoked_at)await revoke(db,f,'Logout');return {sessionId:f.auth_session_id};});if(!result)throw denied();return result;}
 return {issue,refresh,logout,logoutRefresh};
};
