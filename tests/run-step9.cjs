'use strict';

const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const report={startedAt:new Date().toISOString(),results:[]};
 for(const file of ['automatic-attendance.cjs','faculty-class-attendance.cjs','faculty-records-browser.cjs']){
  const start=Date.now(),child=spawn(process.execPath,[path.join(__dirname,file)],{cwd:path.resolve(__dirname,'..'),windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='',timedOut=false;child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
  const timer=setTimeout(()=>{timedOut=true;child.kill();},180000);
  const exitCode=await new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});clearTimeout(timer);
  output=output.replace(/\b[a-f0-9]{64}\b/gi,'[redacted 256-bit value]');
  const cases=(output.match(/^PASS (?:STEP9(?: CHROME)?|AUTOMATIC|ACTIVITY): /gm)||[]).length;
  report.results.push({command:'node tests/'+file,exitCode,timedOut,cases,seconds:(Date.now()-start)/1000,output});
  console.log(file+': '+(exitCode===0&&!timedOut?'PASS':'FAIL')+' ('+cases+' cases)');if(exitCode!==0||timedOut)console.log(output);
 }
 report.finishedAt=new Date().toISOString();report.summary={suites:3,passed:report.results.filter(r=>r.exitCode===0&&!r.timedOut).length,failed:report.results.filter(r=>r.exitCode!==0||r.timedOut).length,skipped:0,blocked:0,cases:report.results.reduce((n,r)=>n+r.cases,0)};
 fs.writeFileSync(path.join(__dirname,'step9-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.summary));process.exitCode=report.summary.failed?1:0;
})().catch(error=>{console.error(error.code||error.message);process.exitCode=1;});
