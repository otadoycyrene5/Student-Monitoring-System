'use strict';
const argon2=require('argon2'),crypto=require('node:crypto');
const options={type:argon2.argon2id,memoryCost:65536,timeCost:3,parallelism:1};
const fail=(status,message)=>Object.assign(new Error(message),{status,public:true});
const invalid=()=>fail(401,'Invalid email or password.');
const tokenHash=token=>crypto.createHash('sha256').update(token).digest();
function createAuthService(pool,lifetime) {
  let dummyHash;
  async function profile(id,connection=pool) {
    const [rows]=await connection.execute(`SELECT u.id,u.email,u.full_name AS fullName,u.role,
      f.faculty_id AS facultyId,f.department,f.academic_position AS academicPosition,
      s.student_id AS studentId,s.program,s.year_level AS yearLevel,s.section
      FROM users u LEFT JOIN faculty_profiles f ON f.user_id=u.id LEFT JOIN student_profiles s ON s.user_id=u.id WHERE u.id=?`,[id]);
    if(!rows.length)throw fail(401,'Authentication required.');
    const r=rows[0],data={id:String(r.id),fullName:r.fullName,email:r.email,role:r.role};
    if(r.role==='faculty')Object.assign(data,{facultyId:r.facultyId,department:r.department,academicPosition:r.academicPosition});
    else if(r.role==='student')Object.assign(data,{studentId:r.studentId,program:r.program,yearLevel:r.yearLevel,section:r.section});
    else throw fail(403,'Role not permitted.');
    return data;
  }
  const renewal=require('./sessionRenewal')(pool,lifetime,profile);
  return {
    updateFacultyProfile:require('./facultyProfileService')(pool,profile),
    updateStudentProfile:require('./studentProfileService')(pool,profile),
    refresh:renewal.refresh,
    logoutRefresh:renewal.logoutRefresh,
    profile,
    async register(role,values) {
      const hash=await argon2.hash(values.password,options),db=await pool.getConnection();
      try {
        await db.beginTransaction();
        const [user]=await db.execute('INSERT INTO users(email,password_hash,full_name,role) VALUES (?,?,?,?)',[values.email,hash,values.fullName,role]);
        if(role==='faculty')await db.execute('INSERT INTO faculty_profiles(user_id,faculty_id,department,academic_position) VALUES (?,?,?,?)',[user.insertId,values.facultyId,values.department,values.academicPosition]);
        else await db.execute('INSERT INTO student_profiles(user_id,student_id,program,year_level,section) VALUES (?,?,?,?,?)',[user.insertId,values.studentId,values.program,values.yearLevel,values.section]);
        const result=await profile(user.insertId,db);await db.commit();return result;
      } catch(error) {await db.rollback();if(error.code==='ER_DUP_ENTRY')throw fail(409,'Email or institutional ID is already registered.');throw error;}
      finally {db.release();}
    },
    async login(values,renewable=false) {
      const [rows]=await pool.execute('SELECT id,password_hash FROM users WHERE email=?',[values.email]);
      dummyHash ||= argon2.hash(crypto.randomBytes(32).toString('hex'),options);
      const hash=rows[0]?.password_hash||await dummyHash;
      let valid=false;
      try {valid=await argon2.verify(hash,values.password);} catch {throw invalid();}
      if(!rows.length||!valid)throw invalid();
      const user=await profile(rows[0].id),token=crypto.randomBytes(32).toString('hex');
      if(renewable)return renewal.issue(user,rows[0].password_hash);
      const expiresAt=new Date(Date.now()+lifetime*1000);
      await pool.execute('INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES (?,?,?)',[user.id,tokenHash(token),expiresAt]);
      return {user,accessToken:token,tokenType:'Bearer',expiresIn:lifetime,expiresAt:expiresAt.toISOString()};
    },
    async authenticate(token) {
      if(!/^[a-f0-9]{64}$/.test(token||''))throw fail(401,'Authentication required.');
      const [rows]=await pool.execute('SELECT s.id,s.user_id,s.expires_at,u.role FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>UTC_TIMESTAMP(3)',[tokenHash(token)]);
      if(!rows.length)throw fail(401,'Authentication required.');
      const r=rows[0];const [[family]]=await pool.execute('SELECT f.*,u.password_hash FROM session_families f JOIN users u ON u.id=f.user_id WHERE f.auth_session_id=?',[r.id]);
      if(family&&(family.revoked_at||family.role!==r.role||!tokenHash(family.password_hash).equals(family.password_fingerprint)||+new Date(family.idle_expires_at)<=Date.now()||+new Date(family.absolute_expires_at)<=Date.now()))throw fail(401,'Authentication required.');
      return {sessionId:r.id,userId:r.user_id,role:r.role,expiresAt:r.expires_at,...(family?{monitoringExpiresAt:family.absolute_expires_at}:{})};
    },
    logout:renewal.logout
  };
}
module.exports={createAuthService};
