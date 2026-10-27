'use strict';
require('../src/config/environment')();
const pool=require('../src/config/database');
(async()=>{const args=process.argv.slice(2);if(args.some(a=>!['--dry-run','--execute'].includes(a))||args.includes('--dry-run')&&args.includes('--execute'))throw new Error('Use --dry-run (default) or --execute.');const result=await require('../src/services/privacyRetention')(pool,{execute:args.includes('--execute')});console.log(JSON.stringify({event:'privacy_retention_run',...result}));})().catch(e=>{console.error(e.public?e.message:'Retention check failed safely; inspect configuration and database availability.');process.exitCode=1;}).finally(()=>pool.end());
