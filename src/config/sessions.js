'use strict';
module.exports=()=>{
 const number=(name,fallback,max)=>{const n=Number(process.env[name]??fallback);if(!Number.isInteger(n)||n<1||n>max)throw new Error('Setup error: '+name+' is outside its allowed range.');return n;};
 const access=number('SESSION_TTL_SECONDS',900,900),absolute=number('SESSION_ABSOLUTE_SECONDS',14400,86400),idle=number('SESSION_IDLE_SECONDS',3600,86400);
 if(idle>absolute||access>idle)throw new Error('Setup error: session lifetimes must satisfy access <= idle <= absolute.');
 return {access,idle,absolute};
};
