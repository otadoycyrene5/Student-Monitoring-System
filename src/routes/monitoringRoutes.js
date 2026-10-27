'use strict';
const express=require('express');
module.exports=(pool,config)=>{
  const router=express.Router(),auth=require('../services/authService').createAuthService(pool,config.lifetime),monitor=require('../services/meetMonitoringService').createMeetMonitoringService(pool);
  router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
  router.use(require('../middleware/authenticate')(auth));
  router.use(require('../middleware/authorize')('student'));
  const abuse=require('../middleware/abuseLimits');router.use(abuse.limit(120,60000,abuse.account));
  const run=(req,work)=>{const checked=async()=>{req.identity=await auth.authenticate(req.authCredential);return work();};return req.app.locals.realtime?req.app.locals.realtime.serial(checked):checked();};
  router.get('/state',async(req,res)=>{if(Object.keys(req.query).join(',')!=='sessionId')return res.status(400).json({success:false,message:'Invalid monitoring query.'});res.json({success:true,data:await run(req,()=>monitor.state(req.identity,req.query.sessionId))});});
  for(const action of ['start','stop','event'])router.post('/'+action,async(req,res)=>{const data=await run(req,()=>monitor[action](req.identity,req.body));await req.app.locals.realtime?.notifyMonitoring(data);res.json({success:true,data});});
  return router;
};
