
'use strict';
(()=>{
 const KEY='classence-student-session',ready=chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});let flight=null,tail=Promise.resolve(),retryAt=0,retries=0;
 const serial=work=>{const next=tail.then(work);tail=next.catch(()=>{});return next;};
 const read=async()=>{await ready;return (await chrome.storage.local.get(KEY))[KEY];};
 const write=async value=>{await ready;if(value)await chrome.storage.local.set({[KEY]:value});else await chrome.storage.local.remove(KEY);};
 async function http(path,body){const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),10000);try{const response=await fetch(CLASSENCE_MONITORING_API+'/api/auth/'+path,{method:'POST',credentials:'omit',signal:abort.signal,headers:{'Content-Type':'application/json','X-Classence-Renewable':'1'},body:JSON.stringify(body)}),result=await response.json();if(!response.ok)throw Object.assign(new Error(result.message||'Authentication failed.'),{status:response.status});return result.data;}finally{clearTimeout(timeout);}}
 const stored=data=>({token:data.accessToken,refreshToken:data.refreshToken,expiresAt:data.expiresAt,absoluteExpiresAt:data.absoluteExpiresAt,sessionId:data.sessionId});
 async function ensure(force=false){if(flight)return flight;flight=serial(async()=>{let saved=await read();if(saved?.pendingLogout){try{await http('logout',{refreshToken:saved.refreshToken});await write(null);}catch(e){if(e.status===401)await write(null);}throw Object.assign(new Error('Please sign in again.'),{status:401});}if(!saved?.token)throw Object.assign(new Error('Please sign in again.'),{status:401});if(!force&&Date.parse(saved.expiresAt)>Date.now()+60000)return saved;
  if(!saved.refreshToken){if(Date.parse(saved.expiresAt)>Date.now())return saved;await write(null);throw Object.assign(new Error('Please sign in again.'),{status:401});}
  if(Date.now()<retryAt)throw new Error('Authentication connection interrupted. Retry shortly.');
  if(retries>=3)retries=0;
  const requestId=saved.pendingRefresh?.id&&Date.now()-saved.pendingRefresh.at<30000?saved.pendingRefresh.id:crypto.randomUUID();saved={...saved,pendingRefresh:{id:requestId,at:Date.now()}};await write(saved);
  try{const data=await http('refresh',{refreshToken:saved.refreshToken,requestId});if(data.user.role!=='student')throw Object.assign(new Error('Student account required.'),{status:403});const next=stored(data);await write(next);retryAt=0;retries=0;return next;}catch(e){if(e.status===401||e.status===403)await write(null);else{retries++;retryAt=Date.now()+Math.min(120000,15000*2**Math.min(retries-1,3));}throw e;}
 }).finally(()=>flight=null);return flight;}
 async function login(email,password){return serial(async()=>{const prior=await read();if(prior?.pendingLogout){await http('logout',{refreshToken:prior.refreshToken});await write(null);}const data=await http('login',{email,password});if(data.user.role!=='student'){await http('logout',{refreshToken:data.refreshToken});throw Object.assign(new Error('Please sign in with a Student account.'),{status:403});}await write(stored(data));retryAt=0;retries=0;return {user:data.user};});}
 async function logout(){return serial(async()=>{const saved=await read();if(saved?.refreshToken)await write({...saved,pendingLogout:true});try{if(saved?.refreshToken)await http('logout',{refreshToken:saved.refreshToken});else if(saved?.token)await fetch(CLASSENCE_MONITORING_API+'/api/auth/logout',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json',Authorization:'Bearer '+saved.token},body:'{}'});await write(null);}catch(e){if(e.status===401)await write(null);throw e;}});}
 globalThis.StudentAuthCoordinator={ensure,login,logout};
 chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(message?.type!=='STUDENT_AUTH'||sender.id!==chrome.runtime.id||sender.url!==chrome.runtime.getURL('index.html'))return;
  if(!['ACCESS','LOGIN','LOGOUT'].includes(message.action)||Object.keys(message).some(k=>!['type','action','email','password','force','recover'].includes(k))){reply({ok:false,status:400,message:'Invalid authentication request.'});return;}
  if(message.action==='ACCESS'&&message.recover===true){retries=0;retryAt=0;}
  const work=message.action==='LOGIN'?login(message.email,message.password):message.action==='LOGOUT'?logout():ensure(message.force===true);
  work.then(data=>reply({ok:true,data:message.action==='ACCESS'?{token:data.token,expiresAt:data.expiresAt}:data})).catch(e=>reply({ok:false,status:e.status||0,message:e.status?e.message:'Cannot connect to the backend. Please try again.'}));return true;
 });
})();
