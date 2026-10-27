'use strict';
module.exports=(error,req,res,next)=>{
  if(res.headersSent)return next(error);
  if(error.public){if(error.status===429&&Number.isInteger(error.retryAfter))res.set('Retry-After',String(error.retryAfter));return res.status(error.status).json({success:false,message:error.message});}
  if(error.code&&/^(ECONN|ETIMEDOUT|EHOST|ENET|PROTOCOL|ER_)/.test(error.code)){
    console.error('Database request failed ['+(/^[A-Z0-9_]+$/.test(error.code)?error.code:'DATABASE_ERROR')+'].');
    return res.status(503).json({success:false,message:'Database service unavailable.'});
  }
  const status=[400,403,413,415].includes(error.status)?error.status:500;
  if(status===500)console.error('Unexpected API error.');
  res.status(status).json({success:false,message:status===400?'Invalid JSON request':status===403?'Origin not allowed':status===413?'Request too large':status===415?'Unsupported JSON encoding':'Internal server error'});
};
