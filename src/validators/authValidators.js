'use strict';
const positions = ['Instructor','Assistant Professor','Associate Professor','Professor','Part Time'];
function validate(kind) {
  return (req,res,next) => {
    const body=req.body, errors={};
    if (!body || Array.isArray(body) || typeof body!=='object') return res.status(400).json({success:false,message:'A JSON object is required'});
    const registration=kind!=='login';
    const required=kind==='faculty' ? {facultyId:80,fullName:160,department:160,academicPosition:40,email:254} : kind==='student' ? {studentId:80,fullName:160,program:160,section:80,email:254} : {email:254};
    const allowed=[...Object.keys(required),'password',...(registration?['confirmPassword']:[]),...(kind==='student'?['yearLevel']:[])];
    if(Object.keys(body).some(key=>!allowed.includes(key))) errors.request='Unexpected fields are not permitted.';
    const values={};
    for(const [key,max] of Object.entries(required)) {
      if(typeof body[key]!=='string'||!body[key].trim()||[...body[key].trim()].length>max) errors[key]=`Enter a non-empty string of at most ${max} characters.`;
      else values[key]=body[key].trim();
    }
    if(values.email){values.email=values.email.toLowerCase();if(!/^\S+@\S+\.\S+$/.test(values.email))errors.email='Enter a valid institutional email address.';}
    if(typeof body.password!=='string'||!body.password.trim()||[...body.password].length<(registration?8:1)||[...body.password].length>128) errors.password=registration?'Password must contain 8–128 characters.':'Enter your password (at most 128 characters).';
    else values.password=body.password;
    if(kind==='faculty'&&values.academicPosition&&!positions.includes(values.academicPosition))errors.academicPosition='Select a supported academic position.';
    if(kind==='student'){
      if(![1,2,3,4,'1','2','3','4'].includes(body.yearLevel))errors.yearLevel='Year Level must be 1–4.';
      else values.yearLevel=Number(body.yearLevel);
    }
    if(registration&&body.confirmPassword!==undefined&&(typeof body.confirmPassword!=='string'||body.confirmPassword!==body.password))errors.confirmPassword='Passwords do not match.';
    if(Object.keys(errors).length)return res.status(400).json({success:false,message:'Please correct the supplied fields.',errors});
    req.validated=values;next();
  };
}
module.exports={validate};
