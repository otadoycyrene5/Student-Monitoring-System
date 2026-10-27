'use strict';
module.exports=service=>({
  register:role=>async(req,res)=>res.status(201).json({success:true,data:{user:await service.register(role,req.validated)}}),
  login:async(req,res)=>{
    const cookie=require('../middleware/facultyCookie'),website=req.get('X-Classence-Client')==='faculty-web';
    if(website&&!cookie.trustedClient(req))return res.status(403).json({success:false,message:'Request origin not permitted.'});
    const work=()=>service.login(req.validated,req.get('X-Classence-Renewable')==='1');
    const data=await(req.app.locals.realtime?req.app.locals.realtime.serial(work):work());
    if(website){
      if(data.user.role!=='faculty'){await service.logout(await service.authenticate(data.accessToken));return res.status(403).json({success:false,message:'Please sign in with a Faculty account.'});}
      cookie.deliver(req,res,data);
    }
    res.json({success:true,data});
  },
  me:async(req,res)=>res.json({success:true,data:{user:await service.profile(req.identity.userId),expiresAt:req.identity.expiresAt}}),
  logout:async(req,res)=>{const work=()=>service.logout(req.identity);await(req.app.locals.realtime?req.app.locals.realtime.serial(work):work());await req.app.locals.realtime?.revoke(req.identity.sessionId);const cookie=require('../middleware/facultyCookie');if(req.cookieAuthentication){res.clearCookie(cookie.cookieName,cookie.settings());res.clearCookie(cookie.refreshName,cookie.settings());}res.json({success:true,message:'Logged out.'});}
});
