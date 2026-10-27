'use strict';
const {Server}=require('socket.io');
const {createAuthService}=require('./services/authService');
const {createLiveService,payload,fail}=require('./services/liveService');
const cookie=require('./middleware/facultyCookie');
const socketPath='/api/auth/socket.io';
async function attachRealtime(server,pool,origins,config={}){
  const security=require('./config/security');security.local();
  if(origins.some(origin=>!security.allowedOrigin(origin)))throw Error('Setup error: Socket.IO requires local HTTP or the approved extension origin.');
  const runtimeConfig={...config,freshnessFloor:Date.now()},auth=createAuthService(pool,900),live=createLiveService(pool,runtimeConfig);

  let lock=await pool.getConnection();const lockName=config.lockName||'classence_realtime_'+(process.env.DB_NAME||'classence');
  const [[acquired]]=await lock.execute('SELECT GET_LOCK(?,0) AS acquired',[lockName]);
  if(acquired.acquired!==1){lock.release();throw new Error('Another real-time backend owns this database.');}
  try{await live.reconcile();const [[clock]]=await pool.execute('SELECT UTC_TIMESTAMP(3) AS now');runtimeConfig.freshnessFloor=+new Date(clock.now)+1;}catch(e){await lock.execute('SELECT RELEASE_LOCK(?)',[lockName]);lock.release();throw e;}
  let tail=Promise.resolve(),closing=false,owning=true,recovering=null;
  const serial=work=>{const result=tail.then(()=>{if(!owning)throw fail(503,'Real-time database recovery in progress.');return work();});tail=result.catch(()=>{});return result;};
  const attempts=new Map();
  const io=new Server(server,{path:socketPath,serveClient:false,connectTimeout:10000,upgradeTimeout:10000,maxHttpBufferSize:4096,pingInterval:10000,pingTimeout:10000,
    cors:{origin:origins,credentials:true,methods:['GET','POST']},
    allowRequest(req,done){const origin=req.headers.origin;if(!origin||!origins.includes(origin))return done(null,false);const key=req.socket.remoteAddress,now=Date.now();let bucket=attempts.get(key);if(!bucket||now-bucket.at>60000){bucket={at:now,count:0};attempts.set(key,bucket);}done(null,++bucket.count<=300);}
  });
  io.engine.use(security.headers());
  io.engine.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
  const userEvents=new Map();
  const presence=new Map(),expirations=new Map(),pendingDisconnects=new Map();
  const key=(sid,uid)=>sid+':'+uid;
  async function verify(socket){socket.data.identity=await auth.authenticate(socket.data.credential);return socket.data.identity;}
  const authError=(socket,reason='authentication_expired_or_revoked')=>{socket.data.disconnectReason=reason;socket.emit('session:error',{code:'AUTH_REQUIRED',message:'Your session expired or was revoked. Please sign in again.'});socket.disconnect(true);};
  io.use(async(socket,next)=>{try{
    if(!owning||closing)throw fail(503,'Backend recovering.');
    const supplied=socket.handshake.auth||{};
    if(typeof supplied!=='object'||Array.isArray(supplied)||Object.keys(supplied).some(k=>!['token','client'].includes(k)))throw fail(401,'Authentication required.');
    if(supplied.client!==undefined&&supplied.client!=='faculty-web'||supplied.token!==undefined&&typeof supplied.token!=='string'||supplied.client==='faculty-web'&&supplied.token!==undefined)throw fail(400,'Invalid authentication payload.');
    if(supplied.client==='faculty-web'&&!(socket.handshake.headers.origin||'').startsWith('http://'))throw fail(403,'Role not permitted.');
    const credential=supplied.client==='faculty-web'?cookie.read(socket.request):supplied.token;
    const identity=await auth.authenticate(credential);
    if(supplied.client==='faculty-web'&&identity.role!=='faculty'||supplied.client!=='faculty-web'&&identity.role!=='student')throw fail(403,'Role not permitted.');
    if([...io.sockets.sockets.values()].filter(s=>String(s.data.identity?.userId)===String(identity.userId)).length>=8)throw fail(429,'Too many connections.');
    socket.data={identity,credential,joined:new Set(),bucket:{at:Date.now(),count:0},inflight:0};next();
  }catch(e){const error=new Error(e.status===403?'Role not permitted.':e.status===429?e.message:'Authentication required.');error.data={code:e.status===403?'FORBIDDEN':e.status===429?'RATE_LIMITED':e.status===401?'AUTH_REQUIRED':'UNAVAILABLE'};next(error);}});
  async function sync(socket){const identity=await verify(socket),snapshot=await live.snapshot(identity);
    for(const room of [...socket.rooms])if(room.startsWith('class:')||room.startsWith('session:'))socket.leave(room);
    for(const c of snapshot.classes){socket.join('class:'+c.id);if(identity.role==='faculty')for(const s of c.sessions)socket.join('session:'+s.id);}
    if(identity.role==='student')for(const sid of socket.data.joined){const allowed=snapshot.classes.some(c=>c.sessions.some(s=>s.id===sid&&s.status==='Live'&&s.participants.some(p=>p.participation==='Joined')));if(allowed)socket.join('session:'+sid);else{socket.data.joined.delete(sid);const k=key(sid,identity.userId),connections=presence.get(k);connections?.delete(socket.id);if(connections?.size===0){presence.delete(k);pendingDisconnects.set(k,{identity,sid,reason:'authorization_changed'});await persistDisconnect(k);}}}
    return snapshot;
  }
  async function publish(event,result){if(!result)return;
    for(const socket of [...io.sockets.sockets.values()]){if(!socket.rooms.has('class:'+result.classId))continue;
      try{const identity=await verify(socket);await live.classAccess(identity,result.classId);socket.emit(event,result);}
      catch(e){if(e.status===401)authError(socket);else if(e.status===403||e.status===404){socket.leave('class:'+result.classId);for(const room of socket.rooms)if(room.startsWith('session:'))socket.leave(room);}else socket.disconnect(true);}
    }
  }
  async function persistDisconnect(k){const pending=pendingDisconnects.get(k);if(!pending)return;const result=await live.offline(pending.identity,pending.sid,false,pending.reason);pendingDisconnects.delete(k);await publish('participant:disconnected',result);}
  async function removeSocket(socket){const identity=socket.data.identity;if(!identity)return;for(const sid of socket.data.joined){const k=key(sid,identity.userId),connections=presence.get(k);connections?.delete(socket.id);if(connections?.size===0){presence.delete(k);pendingDisconnects.set(k,{identity,sid,reason:socket.data.disconnectReason||'socket_disconnected'});try{await persistDisconnect(k);}catch{                                                                        }}}socket.data.joined.clear();}
  io.on('connection',socket=>{
    const identity=socket.data.identity;
    const expiry=setTimeout(()=>authError(socket,'authentication_expired'),Math.max(0,new Date(identity.expiresAt).getTime()-Date.now()));expirations.set(socket.id,expiry);
    const on=(event,keys,work)=>socket.on(event,(value,ack)=>{
      if(typeof ack!=='function')return;
      const bucket=socket.data.bucket,now=Date.now();if(now-bucket.at>60000){bucket.at=now;bucket.count=0;}
      const user=String(socket.data.identity.userId);let aggregate=userEvents.get(user);if(!aggregate){aggregate={at:now,count:0,inflight:0};userEvents.set(user,aggregate);}if(now-aggregate.at>60000){aggregate.at=now;aggregate.count=0;}
      if(++bucket.count>60||++aggregate.count>120||socket.data.inflight>=4||aggregate.inflight>=4){ack({ok:false,error:{code:'RATE_LIMITED',message:'Too many requests. Try again shortly.'}});return;}
      socket.data.inflight++;aggregate.inflight++;let completed=false;
      serial(async()=>{try{if(closing||!socket.connected)throw fail(503,'Connection unavailable.');const who=await verify(socket);payload(value,keys);const data=await work(who,value);ack({ok:true,data});}catch(e){ack({ok:false,error:{code:e.status===401?'AUTH_REQUIRED':e.status===403?'FORBIDDEN':e.status===400?'INVALID_PAYLOAD':e.status===409?'CONFLICT':'UNAVAILABLE',message:e.public?e.message:e.status===401?'Authentication required.':'Unable to complete the request.'}});if(e.status===401)authError(socket);}finally{completed=true;socket.data.inflight--;aggregate.inflight--;}}).catch(()=>{if(!completed){socket.data.inflight--;aggregate.inflight--;ack({ok:false,error:{code:'UNAVAILABLE',message:'Database recovery in progress.'}});}});
    });
    on('realtime:sync',[],()=>sync(socket));
    on('faculty:join-class',['classId'],async(who,v)=>{live.role(who,'faculty');await live.classAccess(who,v.classId);socket.join('class:'+v.classId);return sync(socket);});
    on('faculty:start-session',['classId'],async(who,v)=>{const result=await live.start(who,v.classId);socket.join('class:'+result.classId);socket.join('session:'+result.sessionId);await publish('session:started',result);return result;});
    on('faculty:end-session',['sessionId'],async(who,v)=>{const result=await live.end(who,v.sessionId);for(const [k]of presence)if(k.startsWith(v.sessionId+':'))presence.delete(k);for(const s of io.sockets.sockets.values()){s.data.joined.delete(v.sessionId);s.leave('session:'+v.sessionId);}await publish('session:ended',result);return result;});
    on('student:join-session',['sessionId'],async(who,v)=>{const k=key(v.sessionId,who.userId);await persistDisconnect(k);const result=await live.join(who,v.sessionId);if(!presence.has(k))presence.set(k,new Set());presence.get(k).add(socket.id);socket.data.joined.add(v.sessionId);socket.join('class:'+result.classId);socket.join('session:'+v.sessionId);await publish('participant:connected',result);return result;});
    on('student:leave-session',['sessionId'],async(who,v)=>{live.role(who,'student');await live.sessionAccess(who,v.sessionId);const result=await live.offline(who,v.sessionId,true);const k=key(v.sessionId,who.userId);presence.delete(k);for(const s of io.sockets.sockets.values())if(String(s.data.identity.userId)===String(who.userId)){s.data.joined.delete(v.sessionId);s.leave('session:'+v.sessionId);}await publish('participant:disconnected',result);return result;});
    socket.on('disconnect',()=>{clearTimeout(expirations.get(socket.id));expirations.delete(socket.id);serial(()=>removeSocket(socket)).catch(()=>console.error('Real-time disconnect persistence failed; startup reconciliation will repair stale connectivity.'));});
  });
  let sweeping=false,lastRepair=0;
  const poll=setInterval(async()=>{if(sweeping||closing)return;sweeping=true;try{if(owning&&pendingDisconnects.size&&Date.now()-lastRepair>5000){lastRepair=Date.now();await serial(async()=>{for(const k of pendingDisconnects.keys())await persistDisconnect(k);}).catch(()=>{});}for(const socket of [...io.sockets.sockets.values()]){try{await verify(socket);}catch(error){if(error.status===401)authError(socket);else{socket.emit('session:error',{code:'UNAVAILABLE',message:'Cannot verify the connection. Reconnecting.'});socket.disconnect(true);}}}}finally{sweeping=false;}for(const [ip,b]of attempts)if(Date.now()-b.at>60000)attempts.delete(ip);for(const [user,b]of userEvents)if(!b.inflight&&Date.now()-b.at>60000)userEvents.delete(user);},config.pollMs||1000);poll.unref();

  const lockFailure=()=>{if(closing||!owning)return;owning=false;io.emit('session:error',{code:'UNAVAILABLE',message:'Database connection interrupted. Reconnecting.'});io.disconnectSockets(true);};
  lock.on?.('error',lockFailure);
  const recoverOwner=async()=>{if(closing||owning||recovering)return;recovering=(async()=>{let candidate;try{candidate=await pool.getConnection();const [[r]]=await candidate.execute('SELECT GET_LOCK(?,0) AS acquired',[lockName]);if(r.acquired!==1)return;await tail;await live.reconcile();const [[clock]]=await pool.execute('SELECT UTC_TIMESTAMP(3) AS now');runtimeConfig.freshnessFloor=+new Date(clock.now)+1;lock.removeListener?.('error',lockFailure);lock.release();lock=candidate;candidate=null;lock.on?.('error',lockFailure);pendingDisconnects.clear();presence.clear();owning=true;}catch(error){console.error('Database ownership recovery deferred ['+(/^[A-Z0-9_]+$/.test(error.code||'')?error.code:'RECOVERY_FAILED')+'].');}finally{if(candidate){await candidate.execute('SELECT RELEASE_LOCK(?)',[lockName]).catch(()=>{});candidate.release();}}})().finally(()=>recovering=null);await recovering;};
  const ownershipTimer=setInterval(recoverOwner,5000);ownershipTimer.unref();
  return {isReady:()=>owning&&!closing,io,live,serial,sync,socketPath,notifyMonitoring:result=>publish('monitoring:updated',result&&{classId:result.classId,sessionId:result.sessionId}),
    async revoke(sessionId){for(const socket of [...io.sockets.sockets.values()])if(String(socket.data.identity.sessionId)===String(sessionId))authError(socket);await tail;},
    async close(){closing=true;clearInterval(poll);clearInterval(ownershipTimer);if(recovering)await recovering;io.disconnectSockets(true);await tail;await new Promise(resolve=>io.close(resolve));for(const timer of expirations.values())clearTimeout(timer);lock.removeListener?.('error',lockFailure);try{await lock.execute('SELECT RELEASE_LOCK(?)',[lockName]);}catch{}finally{lock.release();}}
  };
}
module.exports={attachRealtime,socketPath};
