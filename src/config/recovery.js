'use strict';

module.exports=()=>{
 const value=Number(process.env.MONITORING_FRESH_SECONDS||75);
 if(!Number.isInteger(value)||value<60||value>300)throw new Error('Setup error: MONITORING_FRESH_SECONDS must be between 60 and 300.');
 return {freshMs:value*1000,heartbeatMs:30000,pendingMs:15000,delayedMs:5000,maxObservationAgeMs:120000};
};
