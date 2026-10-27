'use strict';
const fail=(status,message)=>Object.assign(new Error(message),{status,public:true});
const validText=(value,max)=>typeof value==='string'&&value.trim()&&[...value.trim()].length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
module.exports=(pool,profile)=>async(who,value)=>{
  if(who.role!=='student')throw fail(403,'Student access is required.');
  if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).some(key=>!['fullName','email','program','yearLevel','section','expectedUserId'].includes(key)))throw fail(400,'Only name, institutional email, program, year level and section can be updated.');
  if(value.expectedUserId!==undefined&&value.expectedUserId!==String(who.userId))throw fail(409,'Your account changed. Reload your profile before saving.');
  if(!validText(value.fullName,160))throw fail(400,'Enter a full name of 1-160 characters without control characters.');
  if(typeof value.email!=='string'||!value.email.trim()||[...value.email.trim()].length>254||!/^\S+@\S+\.\S+$/.test(value.email.trim()))throw fail(400,'Enter a valid institutional email address.');
  if(!validText(value.program,160))throw fail(400,'Enter a program of 1-160 characters without control characters.');
  if(![1,2,3,4,'1','2','3','4'].includes(value.yearLevel))throw fail(400,'Select a valid year level.');
  if(!validText(value.section,80))throw fail(400,'Enter a section of 1-80 characters without control characters.');
  const db=await pool.getConnection();
  try{
    await db.beginTransaction();
    const [[row]]=await db.execute("SELECT s.user_id FROM student_profiles s JOIN users u ON u.id=s.user_id WHERE s.user_id=? AND u.role='student' FOR UPDATE",[who.userId]);
    if(!row)throw fail(403,'Student profile unavailable.');
    await db.execute('UPDATE users SET full_name=?,email=? WHERE id=?',[value.fullName.trim(),value.email.trim().toLowerCase(),who.userId]);
    await db.execute('UPDATE student_profiles SET program=?,year_level=?,section=? WHERE user_id=?',[value.program.trim(),Number(value.yearLevel),value.section.trim(),who.userId]);
    const user=await profile(who.userId,db);
    await db.commit();return user;
  }catch(error){await db.rollback();if(error.code==='ER_DUP_ENTRY')throw fail(409,'That institutional email is already registered.');throw error;}finally{db.release();}
};
