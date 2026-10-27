'use strict';
module.exports=(...roles)=>(req,res,next)=>{
  if(!req.identity)return res.status(401).json({success:false,message:'Authentication required.'});
  if(!roles.includes(req.identity.role))return res.status(403).json({success:false,message:'Role not permitted.'});
  next();
};
