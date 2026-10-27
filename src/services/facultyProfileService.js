'use strict';
const positions=['Instructor','Assistant Professor','Associate Professor','Professor','Part Time'];
const fail=(status,message)=>Object.assign(new Error(message),{status,public:true});
module.exports=(pool,profile)=>async(who,value)=>{
  if(who.role!=='faculty')throw fail(403,'Faculty access is required.');
  if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).some(k=>!['fullName','email','department','academicPosition','expectedUserId'].includes(k)))throw fail(400,'Only name, institutional email, Department and Academic Position can be updated.');


  if(value.expectedUserId!==undefined&&value.expectedUserId!==String(who.userId))throw fail(409,'Your account changed. Reload your profile before saving.');
  if(typeof value.fullName!=='string'||!value.fullName.trim()||[...value.fullName.trim()].length>160||/[\u0000-\u001f\u007f]/.test(value.fullName))throw fail(400,'Enter a full name of 1-160 characters without control characters.');
  if(typeof value.email!=='string'||!value.email.trim()||[...value.email.trim()].length>254||!/^\S+@\S+\.\S+$/.test(value.email.trim()))throw fail(400,'Enter a valid institutional email address.');
  if(typeof value.department!=='string'||!value.department.trim()||[...value.department.trim()].length>160||/[\u0000-\u001f\u007f]/.test(value.department))throw fail(400,'Enter a department of 1-160 characters without control characters.');
  if(typeof value.academicPosition!=='string'||!positions.includes(value.academicPosition))throw fail(400,'Select a supported academic position.');
  const db=await pool.getConnection();
  try{
    await db.beginTransaction();
    const [[row]]=await db.execute('SELECT f.user_id FROM faculty_profiles f JOIN users u ON u.id=f.user_id WHERE f.user_id=? AND u.role=\'faculty\' FOR UPDATE',[who.userId]);
    if(!row)throw fail(403,'Faculty profile unavailable.');
    await db.execute('UPDATE users SET full_name=?,email=? WHERE id=?',[value.fullName.trim(),value.email.trim().toLowerCase(),who.userId]);
    await db.execute('UPDATE faculty_profiles SET department=?,academic_position=? WHERE user_id=?',[value.department.trim(),value.academicPosition,who.userId]);
    const user=await profile(who.userId,db);
    await db.commit();return user;
  }catch(error){await db.rollback();if(error.code==='ER_DUP_ENTRY')throw fail(409,'That institutional email is already registered.');throw error;}finally{db.release();}
};
