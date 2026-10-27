'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');

function log(event,fields={}){const out={at:new Date().toISOString(),event};for(const k of ['state','code','durationMs','attempt','count'])if(typeof fields[k]==='number'||typeof fields[k]==='boolean'||typeof fields[k]==='string'&&/^[a-zA-Z0-9_.:-]{1,80}$/.test(fields[k]))out[k]=fields[k];console.log(JSON.stringify(out));}
function health(pool,{timeoutMs=3000,cacheMs=5000,checkSchema=true,logger=log}={}){
 let cached=null,pending=null,last=0,stopping=false,errors=0,failedAt=0;
 async function inspect(){let connection,timedOut=false,timer;const start=Date.now();
  const work=(async()=>{connection=await pool.getConnection();if(timedOut){connection.destroy?.();throw Error('TIMEOUT');}const query=(connection.query||connection.execute).bind(connection);await query({sql:'SELECT 1',timeout:timeoutMs});
   if(checkSchema){const [rows]=await query({sql:'SELECT version,checksum FROM schema_migrations ORDER BY version',timeout:timeoutMs});const files=fs.readdirSync(path.join(__dirname,'../database/migrations')).filter(n=>/^\d+_.*\.sql$/.test(n)).sort();if(rows.length!==files.length||rows.some((r,i)=>r.version!==files[i]||r.checksum!==crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../database/migrations',files[i]))).digest('hex')))throw Error('SCHEMA');const [[r]]=await query({sql:'SELECT (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()) tables_count,(SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()) triggers_count',timeout:timeoutMs});if(Number(r.tables_count)!==22||Number(r.triggers_count)!==20)throw Error('SCHEMA');}
  })();
  try{await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{timedOut=true;connection?.destroy?.();reject(Error('TIMEOUT'));},timeoutMs);})]);const recovered=failedAt?Date.now()-failedAt:0;if(!cached?.ready)logger('database.recovered',{durationMs:recovered});failedAt=0;cached={ready:true};}
  catch{errors++;if(!failedAt)failedAt=Date.now();if(cached?.ready!==false)logger('database.unavailable');cached={ready:false};}
  finally{clearTimeout(timer);if(connection&&!timedOut)connection.release();last=Date.now();}
  return {...cached,durationMs:Date.now()-start};
 }
 return {async check(force=false){if(stopping)return {ready:false};if(pending)return pending;if(!force&&cached&&Date.now()-last<cacheMs)return cached;pending=inspect().finally(()=>pending=null);return pending;},stop(){stopping=true;logger('readiness.stopping');},metrics(){return {ready:!stopping&&!!cached?.ready,databaseErrors:errors,uptimeSeconds:Math.floor(process.uptime())};}};
}
async function startup(probe,{attempts=3,delayMs=1000}={}){for(let i=1;i<=attempts;i++){if((await probe.check(true)).ready)return;log('startup.deferred',{attempt:i});if(i<attempts)await new Promise(r=>setTimeout(r,delayMs));}throw Error('Required database/schema is unavailable.');}
async function shutdown({server,realtime,pool,probe,graceMs=10000}){probe.stop();log('shutdown.started');const start=Date.now();let timer;const httpClosed=new Promise(resolve=>{server.close(resolve);server.closeIdleConnections?.();});const graceful=(async()=>{await realtime.close();await httpClosed;await pool.end();return true;})();const completed=await Promise.race([graceful,new Promise(r=>{timer=setTimeout(()=>r(false),graceMs);})]);clearTimeout(timer);if(!completed)server.closeAllConnections?.();log(completed?'shutdown.completed':'shutdown.deadline',{durationMs:Date.now()-start});return completed;}
module.exports={log,health,startup,shutdown};
