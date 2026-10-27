'use strict';

const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const commands=[
  ['npm.cmd run test','tests/authentication.cjs'],['npm.cmd run db:verify','database/verify.js'],
  ['npm.cmd run test:monitoring:worker','tests/meet-worker.cjs'],['npm.cmd run test:realtime','tests/realtime.cjs'],
  ['npm.cmd run test:monitoring','tests/meet-monitoring.cjs'],['npm.cmd run test:faculty','tests/faculty-integration.cjs'],
  ['npm.cmd run test:student','tests/student-integration.cjs'],['npm.cmd run test:realtime:browser','tests/realtime-browser.cjs'],
  ['npm.cmd run test:monitoring:chrome','tests/meet-monitoring-browser.cjs'],['npm.cmd run test:e2e','tests/end-to-end.cjs'],
  ['npm.cmd run test:integrity','tests/step8-integrity.cjs'],['node tests/step8-frontend.cjs','tests/step8-frontend.cjs'],
];
(async()=>{
  const report={runId:crypto.randomUUID(),startedAt:new Date().toISOString(),node:process.version,platform:process.platform,results:[]};
  for(const [command,file]of commands){
    const start=Date.now(),child=spawn(process.execPath,[file],{cwd:path.resolve(__dirname,'..'),windowsHide:true,env:{...process.env,CLASSENCE_STEP8_RUN_ID:report.runId},stdio:['ignore','pipe','pipe']});let output='',timedOut=false;
    child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
    const timer=setTimeout(()=>{timedOut=true;child.kill();},240000);
    const exitCode=await new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});clearTimeout(timer);

    output=output.replace(/\b[a-f0-9]{64}\b/gi,'[redacted 256-bit value]');
    report.results.push({command,exitCode,timedOut,seconds:Math.round((Date.now()-start)/10)/100,output});
    fs.writeFileSync(path.join(__dirname,'step8-results.json'),JSON.stringify(report,null,2)+'\n');
    console.log(command+': '+(exitCode===0&&!timedOut?'PASS':'FAIL')+' ('+report.results.at(-1).seconds+'s)');
    if(exitCode!==0)console.log(output);
  }
  report.finishedAt=new Date().toISOString();
  const legacy=JSON.parse(fs.readFileSync(path.join(__dirname,'step8-frontend-results.json'),'utf8'));
  assert.equal(legacy.length,11,'All eleven frontend suites must finish');assert(legacy.every(r=>r.runId===report.runId),'Frontend results must belong to this run');
  assert(report.results.at(-1).exitCode===0 || legacy.some(r=>r.exitCode!==0||r.timedOut),'Frontend host failed outside an individual test; aggregate must fail');
  const suites=[...report.results.slice(0,-1),...legacy];
  report.summary={automatedSuites:suites.length,passed:suites.filter(r=>r.exitCode===0&&!r.timedOut).length,failed:suites.filter(r=>r.exitCode!==0||r.timedOut).length,blocked:0,skipped:0};
  report.durationSeconds=Math.round((Date.parse(report.finishedAt)-Date.parse(report.startedAt))/10)/100;
  fs.writeFileSync(path.join(__dirname,'step8-results.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report.summary));process.exitCode=report.summary.failed?1:0;
})().catch(error=>{console.error(error.code||error.message);process.exitCode=1;});
