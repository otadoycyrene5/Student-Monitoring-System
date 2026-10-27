'use strict';
const {spawn}=require('node:child_process'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
module.exports=async(profilePath)=>{
  const child=spawn(process.env.CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check','--enable-unsafe-extension-debugging','--remote-debugging-pipe','--user-data-dir='+(profilePath||path.join(os.tmpdir(),'classence-student-test-'+crypto.randomUUID())),'about:blank'],{windowsHide:true,stdio:['ignore','ignore','ignore','pipe','pipe']});
  const exited=new Promise(resolve=>child.once('exit',resolve));
  let seq=0,buffer='';const pending=new Map(),events=[];
  child.on('exit',()=>{for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(new Error('Chrome closed'));}pending.clear();});
  child.stdio[4].on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\0'))>=0){const message=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);if(message.id){const entry=pending.get(message.id);if(!entry)continue;pending.delete(message.id);clearTimeout(entry.timer);message.error?entry.reject(new Error(message.error.message)):entry.resolve(message.result);}else events.push(message);}});
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Chrome timeout: '+method));},15000);pending.set(id,{resolve,reject,timer});child.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');});
  try{await send('Browser.getVersion');}catch(error){child.kill();await exited;throw error;}
  const open=async(url,base,existingTarget)=>{
    const list=await send('Target.getTargets');let targetId=existingTarget||list.targetInfos.find(target=>target.type==='page'&&target.url==='about:blank')?.targetId;if(!targetId)targetId=(await send('Target.createTarget',{url:'about:blank'})).targetId;const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
    const command=(method,params)=>send(method,params,sessionId).catch(error=>{throw new Error(method+": "+error.message);});
    await command('Runtime.enable');await command('Page.enable');await command('Network.enable');await command('Log.enable');
    if(base)await command('Page.addScriptToEvaluateOnNewDocument',{source:`const observer=new MutationObserver(()=>{const meta=document.querySelector('meta[name="classence-api"]');if(meta){meta.content=${JSON.stringify(base)};observer.disconnect();}});observer.observe(document,{childList:true,subtree:true});`});
    const evaluate=async expression=>{const result=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
    const wait=async expression=>{for(let i=0;i<120;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50));}throw new Error('Browser wait failed: '+expression);};
    const marker=crypto.randomUUID();await command('Page.addScriptToEvaluateOnNewDocument',{source:'window.__testDocument='+JSON.stringify(marker)});
    await command('Page.navigate',{url});await wait('window.__testDocument==='+JSON.stringify(marker));await wait('(window.StudentAPI||window.FacultyAPI) && !(window.StudentAPI||window.FacultyAPI).checking && (!!(window.StudentAPI||window.FacultyAPI).current || !!document.querySelector("[data-form]"))');
    return {targetId,sessionId,command,evaluate,wait,click:selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`),input:(selector,value)=>evaluate(`document.querySelector(${JSON.stringify(selector)}).value=${JSON.stringify(value)}`),close:()=>send('Target.closeTarget',{targetId})};
  };
  return {send,open,events,async close(){const timer=setTimeout(()=>child.kill(),5000);try{await send('Browser.close').catch(()=>{});await exited;}finally{clearTimeout(timer);child.stdio[3].end();}}};
};
