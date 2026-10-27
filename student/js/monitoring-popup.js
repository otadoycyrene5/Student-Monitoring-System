(()=>{
  'use strict';
  const native=location.protocol==='chrome-extension:';
  async function message(action,values={}){
    if(!native)return null;
    const result=await chrome.runtime.sendMessage({type:'MEET_MONITOR',action,...values});
    if(!result?.ok)throw new Error(result?.message||'Monitoring worker unavailable.');
    return result.data;
  }
  window.StudentMonitoring={
    stop:()=>message('END_SESSION'),
    autoStart:(sessionId,email)=>message('AUTO_START',{sessionId,email}),
    enable:email=>message('ENABLE',{email}),
    withdraw:()=>message('WITHDRAW')
  };
})();
