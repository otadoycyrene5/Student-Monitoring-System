'use strict';
module.exports=service=>async(req,res,next)=>{
  try{
    const cookie=require('./facultyCookie'),authorization=req.get('Authorization');
    const match=/^Bearer ([a-f0-9]{64})$/.exec(authorization||'');
    const token=authorization?match?.[1]:cookie.read(req);
    if(!authorization&&token&&!['GET','HEAD','OPTIONS'].includes(req.method)&&!cookie.trustedClient(req))return res.status(403).json({success:false,message:'Request origin not permitted.'});
    req.identity=await service.authenticate(token);req.authCredential=token;req.cookieAuthentication=!authorization&&Boolean(token);next();
  }catch(error){next(error);}
};
