'use strict';
const crypto=require('node:crypto');
const error=message=>Object.assign(new Error(message),{status:400,public:true});
function input(req,res,next){
 try{
  if(Object.keys(req.query).length&&req.path!=='/api/auth/monitoring/state')throw error('Query parameters are not permitted.');
  if(req.body!==undefined){
   if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))throw error('A JSON object is required.');
   const work=[[req.body,0]];let nodes=0;
   while(work.length){const [value,depth]=work.pop();if(depth>12||++nodes>20000)throw error('Request structure is too complex.');if(value&&typeof value==='object')for(const key of Object.keys(value)){if(['__proto__','prototype','constructor'].includes(key))throw error('Reserved fields are not permitted.');if(value[key]&&typeof value[key]==='object')work.push([value[key],depth+1]);}}
  }next();
 }catch(e){next(e);}
}
function audit(req,res,next){req.requestId=crypto.randomUUID();res.set('X-Request-ID',req.requestId);res.on('finish',()=>{if(res.statusCode>=400){const event={event:'api_rejected',requestId:req.requestId,method:req.method,route:typeof req.route?.path==='string'?req.route.path:'unmatched',status:res.statusCode};if(req.identity){event.userId=String(req.identity.userId);event.sessionId=String(req.identity.sessionId);}console.warn(JSON.stringify(event));}});next();}
module.exports={input,audit};
