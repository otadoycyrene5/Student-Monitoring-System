'use strict';
const {rateLimit}=require('express-rate-limit'),crypto=require('node:crypto');
const hash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
function limit(max,windowMs,keyGenerator){return rateLimit({windowMs,limit:max,standardHeaders:'draft-8',legacyHeaders:false,validate:{xForwardedForHeader:false,forwardedHeader:false},...(keyGenerator?{keyGenerator}:{}),message:{success:false,message:'Too many requests. Try again shortly.'}});}
const account=req=>'account:'+String(req.identity.userId);
const login=req=>'login:'+hash(typeof req.body?.email==='string'?req.body.email.trim().toLowerCase():'invalid');
const refresh=req=>{const cookie=require('./facultyCookie'),token=req.get('X-Classence-Client')==='faculty-web'?cookie.read(req,cookie.refreshName):req.body?.refreshToken;return 'refresh:'+hash(typeof token==='string'&&/^[a-f0-9]{64}$/.test(token)?token:'invalid');};
module.exports={limit,account,login,refresh};
