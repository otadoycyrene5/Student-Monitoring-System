
(()=>{
 'use strict';
 const baseUrl=document.querySelector('meta[name="classence-api"]')?.content||'http://127.0.0.1:3000',logoutBlock='classence-faculty-signed-out',pendingKey='classence-faculty-renewal-request';
 let faculty=null,checking=true,version=0,expiresAt=0,flight=null,retryAt=0,retries=0;
 const map=u=>({id:u.id,name:u.fullName,email:u.email,role:'teacher',facultyId:u.facultyId,department:u.department,academicRank:u.academicPosition});
 async function raw(path,options={}){const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),12000);try{const response=await fetch(baseUrl+path,{...options,credentials:'include',signal:abort.signal,headers:{'Content-Type':'application/json','X-Classence-Client':'faculty-web',...options.headers}}),body=await response.json();if(!response.ok)throw Object.assign(new Error(body.message||'Request failed.'),{status:response.status,errors:body.errors});return body;}catch(e){if(e.status)throw e;throw new Error('Cannot connect to the backend. Please try again.');}finally{clearTimeout(timer);}}
 function clear(){version++;faculty=null;expiresAt=0;window.dispatchEvent(new Event('faculty-session-ended'));}
 async function renew(){if(flight)return flight;const started=version;
  const work=async()=>{if(localStorage.getItem(logoutBlock))throw Object.assign(new Error('Please sign in again.'),{status:401});
   try{const current=await raw('/api/auth/faculty/me');if(Date.parse(current.data.expiresAt)>Date.now()+60000){expiresAt=Date.parse(current.data.expiresAt);localStorage.removeItem(pendingKey);return;}}catch(e){if(e.status!==401)throw e;}
   const prior=JSON.parse(localStorage.getItem(pendingKey)||'null'),requestId=prior&&Date.now()-prior.at<30000?prior.id:crypto.randomUUID();localStorage.setItem(pendingKey,JSON.stringify({id:requestId,at:Date.now()}));
   const result=await raw('/api/auth/refresh',{method:'POST',body:JSON.stringify({requestId})});if(started!==version)return;expiresAt=Date.parse(result.data.expiresAt);retries=0;localStorage.removeItem(pendingKey);localStorage.setItem('classence-faculty-renewed',String(Date.now()));window.dispatchEvent(new Event('faculty-session-renewed'));
  };
  flight=(navigator.locks?navigator.locks.request('classence-faculty-renewal',work):Promise.reject(new Error('This browser requires Web Locks for secure session renewal.'))).catch(e=>{retries++;retryAt=Date.now()+Math.min(120000,15000*2**Math.min(retries,3));if(e.status===401||e.status===403)clear();throw e;}).finally(()=>flight=null);return flight;
 }
 async function request(path,options={}){try{return await raw(path,options);}catch(e){if(e.status===401&&!['/api/auth/login','/api/auth/logout','/api/auth/refresh'].includes(path)){await renew();return raw(path,options);}throw e;}}
 async function restore(){checking=true;const started=version;try{if(localStorage.getItem(logoutBlock)){faculty=null;try{await raw('/api/auth/logout',{method:'POST',body:'{}'});}catch{}return null;}const r=await request('/api/auth/faculty/me');if(r.data.user.role!=='faculty')throw Object.assign(new Error('Please sign in with a Faculty account.'),{status:403});if(started!==version)return faculty;faculty=map(r.data.user);expiresAt=Date.parse(r.data.expiresAt);return faculty;}catch(e){if(e.status===401){faculty=null;return null;}if(e.status===403)faculty=null;throw e;}finally{checking=false;}}
 window.FacultyAPI={request,renew,restore,invalidateSession:clear,get current(){return faculty;},get checking(){return checking;},
 async updateProfile(values,userId=faculty?.id){const started=version;if(!faculty)throw new Error('Please sign in again.');if(!userId||faculty.id!==userId)throw new Error('Your account changed. Reload your profile before saving.');const r=await request('/api/auth/faculty/me',{method:'PATCH',body:JSON.stringify({...values,expectedUserId:userId})});if(started!==version||faculty?.id!==userId||r.data.user.id!==userId)throw new Error('Your account changed. Please reload your profile.');faculty=map(r.data.user);return faculty;},
 register:v=>request('/api/auth/faculty/register',{method:'POST',body:JSON.stringify({facultyId:v.facultyId,fullName:v.name,department:v.department,academicPosition:v.academicRank,email:v.email,password:v.password})}),
 async login(email,password){if(localStorage.getItem(logoutBlock)){try{await raw('/api/auth/logout',{method:'POST',body:'{}'});}catch(e){if(e.status!==401)throw e;}}const r=await raw('/api/auth/login',{method:'POST',headers:{'X-Classence-Renewable':'1'},body:JSON.stringify({email,password})});localStorage.removeItem(logoutBlock);expiresAt=Date.parse(r.data.expiresAt);return restore();},
 async logout(){localStorage.setItem(logoutBlock,'1');try{const work=()=>raw('/api/auth/logout',{method:'POST',body:'{}'});await(navigator.locks?navigator.locks.request('classence-faculty-renewal',work):work());}finally{clear();}}
 };
 window.addEventListener('storage',event=>{if(event.key===logoutBlock&&event.newValue){clear();return;}if(event.key==='classence-faculty-renewed'&&faculty)window.dispatchEvent(new Event('faculty-session-renewed'));});
 setInterval(()=>{if(faculty&&expiresAt<=Date.now()+60000&&Date.now()>=retryAt&&retries<3)renew().catch(()=>{});},15000);
})();
