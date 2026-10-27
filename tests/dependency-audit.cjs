'use strict';

const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const cli=process.env.npm_execpath||path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
const report={checkedAt:new Date().toISOString(),results:[]};let resultCode=0;
for(const omit of [false,true]){const command='npm.cmd audit '+(omit?'--omit=dev ':'')+'--json',result=spawnSync(process.execPath,[cli,'audit',...(omit?['--omit=dev']:[]),'--json'],{cwd:path.resolve(__dirname,'..'),windowsHide:true,encoding:'utf8',timeout:60000});let body;try{body=JSON.parse(result.stdout);}catch{}const entry={command,exitCode:result.status??1,...(body?.metadata?{metadata:body.metadata,vulnerabilities:body.vulnerabilities}:{error:'Registry audit unavailable; no vulnerability conclusion.'})};report.results.push(entry);console.log(command+': exit '+entry.exitCode+'; '+(body?.metadata?JSON.stringify(body.metadata.vulnerabilities):entry.error));if(entry.exitCode!==0)resultCode=entry.exitCode;}
fs.writeFileSync(path.join(__dirname,'security-dependencies.json'),JSON.stringify(report,null,2)+'\n');process.exitCode=resultCode;
