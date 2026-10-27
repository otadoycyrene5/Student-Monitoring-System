'use strict';

require('./config/environment')();

const express = require('express');
const cors = require('cors');
const security=require('./config/security');

function setup(options = {}) {
  const port = Number(process.env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Setup error: PORT must be an integer between 1 and 65535.');
  const { origins } = security.local();
  const pool = options.pool || require('./config/database');
  const integerSetting = (key, fallback, max) => {
    const value = Number(process.env[key] ?? fallback);
    if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`Setup error: ${key} must be an integer between 1 and ${max}.`);
    return value;
  };
  const authConfig = { lifetime: integerSetting('SESSION_TTL_SECONDS',900,900), loginLimit: integerSetting('AUTH_LOGIN_LIMIT',15,1000), registerLimit: integerSetting('AUTH_REGISTER_LIMIT',10,1000) };
  require('./config/sessions')();
  const app = express();
  const operations=require('./operations'),probe=operations.health(pool);
  app.locals.operations=probe;
  app.set('trust proxy',false);
  app.disable('x-powered-by');
  app.use(security.headers());
  app.use(require('./middleware/requestSecurity').audit);
  app.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
  app.use(cors({ credentials:true,methods:['GET','HEAD','POST','PATCH','DELETE','OPTIONS'],allowedHeaders:['Content-Type','Authorization','X-Classence-Client','X-Classence-Renewable'],exposedHeaders:['X-Request-ID','RateLimit','RateLimit-Policy','Retry-After'], origin(origin, callback) {
    if (!origin || origins.includes(origin)) return callback(null, true);
    const error = new Error('Origin not allowed'); error.status = 403; callback(error);
  } }));
  app.use('/api/auth',require('./middleware/abuseLimits').limit(1200,60000));
  app.use('/api/health',require('./middleware/abuseLimits').limit(60,60000));
  app.use(express.json({ limit: '100kb' }));
  app.use((req,res,next)=>{if(['POST','PATCH'].includes(req.method)&&!req.is('application/json'))return res.status(415).json({success:false,message:'Use application/json.'});next();});
  app.use(require('./middleware/requestSecurity').input);
  app.use('/api/auth',async(req,res,next)=>{if(options.enforceReadiness&&(!(await probe.check()).ready||app.locals.realtime&&!app.locals.realtime.isReady()))return res.status(503).json({success:false,message:'Service temporarily unavailable.'});next();});
  app.use('/api/auth', require('./routes/authRoutes')(pool, authConfig));
  app.use('/api/auth/monitoring',require('./routes/monitoringRoutes')(pool,authConfig));
  app.use('/api/auth/live',require('./routes/liveRoutes')(pool,authConfig));
  app.use('/api/auth/privacy',require('./routes/privacyRoutes')(pool,authConfig));
  const databaseError = error => console.error(`MySQL check failed [${/^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'DATABASE_ERROR'}]. Check the MySQL service, database, account and backend/.env.`);
  app.get('/api/health', (req, res) => res.json({ success: true, message: 'Classence backend is running' }));
  const readiness=async(req,res)=>{const result=await probe.check();const ready=result.ready&&(!app.locals.realtime||app.locals.realtime.isReady());res.status(ready?200:503).json({success:ready,message:ready?'Service ready':'Service temporarily unavailable'});};
  app.get('/api/health/database',readiness);
  app.get('/api/health/ready',readiness);
  app.use((req, res) => res.status(404).json({ success: false, message: 'Route not found' }));
  app.use(require('./middleware/errorHandler'));
  async function createHttpServer(){
    const server=require('node:http').createServer(app);
    const realtime=await require('./realtime').attachRealtime(server,pool,origins);
    app.locals.realtime=realtime;
    return {server,realtime};
  }
  return { app, pool, port, databaseError,createHttpServer,probe };
}

if (require.main === module) {
  let startupPool;
  (async()=>{
    const operations=require('./operations'),instance=setup({enforceReadiness:true}),{pool,port,probe}=instance;
    startupPool=pool;
    operations.log('startup.started');
    await operations.startup(probe);
    const {server,realtime}=await instance.createHttpServer();
    server.listen(port,security.host,()=>operations.log('startup.ready'));
    let stopping=false;
    const shutdown=async()=>{if(stopping)return;stopping=true;try{const complete=await operations.shutdown({server,realtime,pool,probe});if(!complete)process.exit(1);}catch{operations.log('shutdown.failed');process.exit(1);}};
    server.on('error',()=>{process.exitCode=1;shutdown();});
    process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
  })().catch(error=>{console.error('Backend startup failed: '+(error.message?.startsWith('Setup error:')||error.message?.startsWith('Another real-time')?error.message:'Check MySQL and the backend configuration.'));process.exitCode=1;startupPool?.end().catch(()=>{});});
}
module.exports={setup};
