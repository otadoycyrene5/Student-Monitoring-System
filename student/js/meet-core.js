
((root)=>{
  'use strict';
  const meetingCode=/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/i;
  function parsed(value){try{const u=new URL(value);if(u.protocol!=='https:'||u.hostname!=='meet.google.com'||u.port||u.username||u.password)return null;const parts=u.pathname.split('/').filter(Boolean),candidate=parts.length===1?parts[0]:parts.length===2&&['meet','landing','lookup'].includes(parts[0])?parts[1]:null;return candidate&&meetingCode.test(candidate)?{code:candidate.toLowerCase(),pathShape:'/'+parts.map(part=>meetingCode.test(part)?':code':part).join('/')}:null;}catch{return null;}}
  function code(value){return parsed(value)?.code||null;}
  function describe(value){try{const u=new URL(value);if(u.protocol!=='https:'||u.hostname!=='meet.google.com'||u.port||u.username||u.password)return null;const parts=u.pathname.split('/').filter(Boolean);return '/'+parts.map(part=>meetingCode.test(part)?':code':['meet','landing','lookup'].includes(part)?part:':segment').join('/');}catch{return null;}}
  function observe(meetingCode,tabs,windows,seen=false){const matching=tabs.filter(t=>code(t.url)===meetingCode);const focused=new Set(windows.filter(w=>w.focused&&w.type==='normal').map(w=>w.id));return {tabState:matching.length?(matching.some(t=>t.active&&focused.has(t.windowId))?'MEET_TAB_SELECTED':'MEET_TAB_NOT_SELECTED'):seen?'MEET_TAB_CLOSED':'MEET_TAB_NOT_OPEN',seen:seen||matching.length>0};}
  const api={code,describe,observe};if(typeof module==='object')module.exports=api;else root.MeetCore=api;
})(globalThis);
