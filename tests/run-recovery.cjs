'use strict';
const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const report={startedAt:new Date().toISOString(),results:[]};
 for(const file of ['recovery-api.cjs','recovery-clients.cjs','recovery-worker.cjs','recovery-process.cjs','meet-monitoring-browser.cjs']){
  const start=Date.now(),child=spawn(process.execPath,[path.join(__dirname,file)],{cwd:path.resolve(__dirname,'..'),env:{...process.env,...(file==='meet-monitoring-browser.cjs'?{CLASSENCE_RECOVERY_TEST:'1'}:{})},windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',timedOut=false;
  child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);const timer=setTimeout(()=>{timedOut=true;child.kill();},240000);
  const exitCode=await new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});clearTimeout(timer);output=output.replace(/\b[a-f0-9]{64}\b/gi,'[redacted]');
  const result={command:'node tests/'+file,kind:file==='meet-monitoring-browser.cjs'?'actual Chrome plus real MySQL/HTTP runtime restart':file==='recovery-api.cjs'?'real HTTP/MySQL/Socket.IO with injected database failures':file==='recovery-process.cjs'?'actual child-process kill/restart; real MySQL via rollback-preserving test SQL IPC':'controlled VM',exitCode,timedOut,cases:(output.match(/^PASS RECOVERY /gm)||[]).length,seconds:(Date.now()-start)/1000,output};report.results.push(result);console.log(file+': '+(exitCode===0&&!timedOut?'PASS':'FAIL'));if(exitCode!==0||timedOut)console.log(output);
 }
 report.finishedAt=new Date().toISOString();report.summary={suites:report.results.length,passed:report.results.filter(r=>r.exitCode===0&&!r.timedOut).length,failed:report.results.filter(r=>r.exitCode!==0||r.timedOut).length,skipped:0,cases:report.results.reduce((n,r)=>n+r.cases,0)};fs.writeFileSync(path.join(__dirname,'recovery-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.summary));process.exitCode=report.summary.failed?1:0;
})().catch(e=>{console.error(e.code||e.message);process.exitCode=1;});
