'use strict';
const fail=message=>Object.assign(new Error(message),{public:true,status:403});
module.exports=async(pool,{execute=false,enabled=process.env.PRIVACY_CLEANUP_ENABLED==='true',settings=require('../config/privacy')().config}={})=>{
 const retention=settings.retention,days=retention.days.credentialRecovery;
 if(execute&&(!enabled||!retention.approved||!settings.policyApproved||typeof retention.approvalReference!=='string'||!retention.approvalReference.trim()||!Number.isInteger(days)||days<1))throw fail('Cleanup disabled or institutional approval/retention setting missing.');
 const result={mode:execute?'EXECUTE':'DRY_RUN',category:'credentialRecovery',approved:retention.approved,configuredDays:days,candidates:0,changed:0,protected:['attendance','attendanceAudit','account','enrollment','participation','monitoring','privacyRequests','privacyAudit','legal holds','open privacy requests'],unsupportedCategories:'Other categories are report-only pending institutional procedures; no deletion is implemented.'};
 if(!Number.isInteger(days)||days<1)return result;
 const db=await pool.getConnection();try{
  await db.beginTransaction();

  await db.execute('SELECT id FROM privacy_holds FOR UPDATE');await db.execute('SELECT id FROM privacy_requests FOR UPDATE');
  const [rows]=await db.execute("SELECT r.id FROM refresh_credentials r JOIN session_families f ON f.id=r.family_id WHERE r.retry_envelope IS NOT NULL AND r.used_at < DATE_SUB(UTC_TIMESTAMP(3),INTERVAL ? DAY) AND f.absolute_expires_at < UTC_TIMESTAMP(3) AND NOT EXISTS (SELECT 1 FROM privacy_holds h WHERE h.released_at IS NULL AND (h.student_user_id IS NULL OR h.student_user_id=f.user_id) AND h.category IN ('ALL','CREDENTIAL_RECOVERY')) AND NOT EXISTS (SELECT 1 FROM privacy_requests p WHERE p.student_user_id=f.user_id AND p.status<>'WITHDRAWN') ORDER BY r.id LIMIT 100 FOR UPDATE",[days]);
  result.candidates=rows.length;result.batchLimit=100;
  if(execute)for(const row of rows){const [r]=await db.execute('UPDATE refresh_credentials SET retry_envelope=NULL WHERE id=? AND retry_envelope IS NOT NULL',[row.id]);result.changed+=r.affectedRows;}
  if(execute)await db.commit();else await db.rollback();return result;
 }catch(error){await db.rollback();throw error;}finally{db.release();}
};
