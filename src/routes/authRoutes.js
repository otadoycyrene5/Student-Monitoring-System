'use strict';
const express=require('express');
const {validate}=require('../validators/authValidators'),{createAuthService}=require('../services/authService');
const authenticate=require('../middleware/authenticate'),authorize=require('../middleware/authorize');
module.exports=(pool,config)=>{
  const router=express.Router(),service=createAuthService(pool,config.lifetime),controller=require('../controllers/authController')(service);
  const limit=max=>require('../middleware/abuseLimits').limit(max,15*60*1000);
  const abuse=require('../middleware/abuseLimits');
  const registrationLimit=limit(120),registrationAccountLimit=abuse.limit(config.registerLimit,15*60000,abuse.login),loginLimit=limit(300),loginAccountLimit=abuse.limit(config.loginLimit,15*60000,abuse.login),auth=authenticate(service);
  router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
  router.post('/faculty/register',registrationLimit,registrationAccountLimit,validate('faculty'),controller.register('faculty'));
  router.post('/student/register',registrationLimit,registrationAccountLimit,validate('student'),controller.register('student'));
  router.post('/login',loginLimit,loginAccountLimit,validate('login'),controller.login);
  const cookie=require('../middleware/facultyCookie');
  const renewalLimit=abuse.limit(300,60000),credentialLimit=abuse.limit(30,60000,abuse.refresh);
  const refreshCredential=req=>{
    if(Object.keys(req.query).length)throw Object.assign(new Error('Query parameters are not permitted.'),{status:400,public:true});
    const website=req.get('X-Classence-Client')==='faculty-web';
    if(website&&!cookie.trustedClient(req))throw Object.assign(new Error('Request origin not permitted.'),{status:403,public:true});
    if(!req.body||typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).some(k=>!(website?['requestId']:['requestId','refreshToken']).includes(k)))throw Object.assign(new Error('Invalid renewal request.'),{status:400,public:true});
    return {token:website?cookie.read(req,cookie.refreshName):req.body.refreshToken,role:website?'faculty':'student'};
  };
  const serial=(req,work)=>req.app.locals.realtime?req.app.locals.realtime.serial(work):work();
  router.post('/refresh',renewalLimit,credentialLimit,async(req,res)=>{const {token,role}=refreshCredential(req);const data=await serial(req,()=>service.refresh(token,req.body.requestId,role));res.json({success:true,data:cookie.deliver(req,res,data)});});
  router.post('/logout',renewalLimit,credentialLimit,async(req,res,next)=>{const website=req.get('X-Classence-Client')==='faculty-web',token=website?cookie.read(req,cookie.refreshName):req.body?.refreshToken;if(!token)return next();const input=refreshCredential(req);const identity=await serial(req,()=>service.logoutRefresh(input.token));await req.app.locals.realtime?.revoke(identity.sessionId);if(website){res.clearCookie(cookie.cookieName,cookie.settings());res.clearCookie(cookie.refreshName,cookie.settings());}res.json({success:true,message:'Logged out.'});});
  router.get('/me',auth,controller.me);
  router.get('/faculty/me',auth,authorize('faculty'),controller.me);
  router.patch('/faculty/me',auth,authorize('faculty'),abuse.limit(30,60000,abuse.account),async(req,res)=>{
    if(Object.keys(req.query).length)return res.status(400).json({success:false,message:'Query parameters are not permitted.'});
    const user=await serial(req,async()=>{const who=await service.authenticate(req.authCredential);return service.updateFacultyProfile(who,req.body);});
    res.json({success:true,message:'Profile updated.',data:{user}});
  });
  router.get('/student/me',auth,authorize('student'),controller.me);
  router.patch('/student/me',auth,authorize('student'),abuse.limit(30,60000,abuse.account),async(req,res)=>{
    if(Object.keys(req.query).length)return res.status(400).json({success:false,message:'Query parameters are not permitted.'});
    const user=await serial(req,async()=>{const who=await service.authenticate(req.authCredential);return service.updateStudentProfile(who,req.body);});
    res.json({success:true,message:'Profile updated.',data:{user}});
  });
  router.post('/logout',auth,controller.logout);
  return router;
};
