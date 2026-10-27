'use strict';
const cookieName='classence_faculty_session';
const settings=()=>({httpOnly:true,secure:false,sameSite:'strict',path:'/api/auth'});
function trustedClient(req){const origin=req.get('Origin')||'';return req.get('X-Classence-Client')==='faculty-web' && origin.startsWith('http://') && require('../config/security').allowedOrigin(origin) && String(process.env.CLIENT_ORIGIN||'').split(',').map(x=>x.trim()).includes(origin);}
function read(req,name=cookieName){const part=((req.get?req.get('Cookie'):req.headers?.cookie)||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='));return part?.slice(name.length+1);}
const refreshName='classence_faculty_refresh';
function deliver(req,res,data){if(req.get('X-Classence-Client')==='faculty-web'){res.cookie(cookieName,data.accessToken,{...settings(),maxAge:Math.max(0,Math.min(data.expiresIn*1000,Date.parse(data.expiresAt)-Date.now()))});if(data.refreshToken)res.cookie(refreshName,data.refreshToken,{...settings(),maxAge:Math.max(0,Date.parse(data.absoluteExpiresAt)-Date.now())});else res.clearCookie(refreshName,settings());delete data.accessToken;delete data.refreshToken;data.tokenType='HttpOnlyCookie';}return data;}
module.exports={cookieName,refreshName,settings,trustedClient,read,deliver};
