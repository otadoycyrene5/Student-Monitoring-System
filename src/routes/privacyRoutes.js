'use strict';
module.exports=(pool,config)=>{
 const router=require('express').Router(),auth=require('../services/authService').createAuthService(pool,config.lifetime),privacy=require('../services/privacyService')(pool),abuse=require('../middleware/abuseLimits');
 router.get('/notice',abuse.limit(60,60000),(req,res)=>res.json({success:true,data:privacy.publicNotice()}));
 router.use(require('../middleware/authenticate')(auth),abuse.limit(30,60000,abuse.account));
 const run=(req,work)=>{const checked=async()=>{req.identity=await auth.authenticate(req.authCredential);return work();};return req.app.locals.realtime?req.app.locals.realtime.serial(checked):checked();};
 router.get('/student/notice',async(req,res)=>res.json({success:true,data:await run(req,()=>privacy.notice(req.identity))}));
 router.post('/student/acknowledgements',async(req,res)=>res.json({success:true,data:await run(req,()=>privacy.acknowledge(req.identity,req.body))}));
 router.get('/student/self',async(req,res)=>res.json({success:true,data:await run(req,()=>privacy.data(req.identity))}));
 router.post('/student/export',abuse.limit(3,15*60000,abuse.account),async(req,res)=>{if(!req.body||Object.keys(req.body).length) return res.status(400).json({success:false,message:'Export accepts no identity or filter fields.'});const result=await run(req,()=>privacy.data(req.identity,true));res.attachment('classence-my-data.json').json({success:true,data:result});});
 router.get('/requests',async(req,res)=>res.json({success:true,data:await run(req,()=>privacy.list(req.identity))}));
 router.post('/requests',abuse.limit(5,60*60000,abuse.account),async(req,res)=>res.status(201).json({success:true,data:await run(req,()=>privacy.submit(req.identity,req.body))}));
 router.patch('/requests/:requestId',async(req,res)=>res.json({success:true,data:await run(req,()=>privacy.update(req.identity,req.params.requestId,req.body))}));
 return router;
};
