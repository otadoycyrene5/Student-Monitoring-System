'use strict';
require('dotenv').config({path:require('node:path').join(__dirname,'../.env'),quiet:true});
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),pool=require('../src/config/database');
const queries=require('../database/integrity-queries.cjs');
(async()=>{
  const result={checkedAt:new Date().toISOString(),checks:[],schema:{}};
  try{
    const [[version]]=await pool.query('SELECT VERSION() version');result.schema.version=version.version;
    const [migrations]=await pool.query('SELECT version,checksum FROM schema_migrations ORDER BY version');
    for(const row of migrations)assert.equal(row.checksum,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../database/migrations',row.version))).digest('hex'));
    assert.deepEqual(migrations.map(m=>m.version),['001_initial_schema.sql','002_auth_sessions.sql','003_meet_monitoring.sql','004_attendance_audit.sql','005_secure_sessions.sql','006_student_privacy.sql','007_privacy_explicit_restrict.sql']);result.schema.migrations=migrations.map(m=>m.version);
    const [[tables]]=await pool.query('SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');assert.equal(tables.n,22);result.schema.tables=tables.n;
    const [[triggers]]=await pool.query('SELECT COUNT(*) n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()');assert.equal(triggers.n,20);result.schema.triggers=triggers.n;
    const [installed]=await pool.query('SELECT TRIGGER_NAME name,ACTION_STATEMENT body FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()');
    const normalize=value=>value.replace(/\s+/g,' ').trim().toLowerCase();
    for(const migration of migrations){const sql=fs.readFileSync(path.join(__dirname,'../database/migrations',migration.version),'utf8');for(const block of sql.split('-- statement-break')){const name=/CREATE TRIGGER (\w+)/.exec(block)?.[1];if(!name)continue;const expected=block.split('FOR EACH ROW')[1].replace(/END\$\$[\s\S]*$/,'END');assert.equal(normalize(installed.find(t=>t.name===name)?.body||''),normalize(expected),'Installed trigger body: '+name);}}
    const [foreignKeys]=await pool.query("SELECT TABLE_NAME tableName,CONSTRAINT_NAME constraintName,COLUMN_NAME columnName,REFERENCED_TABLE_NAME parent,REFERENCED_COLUMN_NAME parentColumn FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION");
    for(const [constraint,columns]of [['fk_meet_participant',['session_id','student_user_id']],['fk_meet_auth',['auth_session_id']]])assert.deepEqual(foreignKeys.filter(k=>k.constraintName===constraint).map(k=>k.columnName),columns);
    result.schema.foreignKeys=foreignKeys;
    for(const [constraint,column,parent,parentColumn]of [['fk_attendance_audit_session','session_id','sessions','id'],['fk_attendance_audit_faculty','faculty_user_id','faculty_profiles','user_id']]){
      const rows=foreignKeys.filter(k=>k.constraintName===constraint);assert.equal(rows.length,1);assert.equal(rows[0].columnName,column);assert.equal(rows[0].parent,parent);assert.equal(rows[0].parentColumn,parentColumn);
    }
    for(const [constraint,column,parent,parentColumn]of [['fk_family_auth','auth_session_id','auth_sessions','id'],['fk_family_user','user_id','users','id'],['fk_refresh_family','family_id','session_families','id'],['fk_security_family','family_id','session_families','id']]){
      const rows=foreignKeys.filter(k=>k.constraintName===constraint);assert.equal(rows.length,1);assert.equal(rows[0].columnName,column);assert.equal(rows[0].parent,parent);assert.equal(rows[0].parentColumn,parentColumn);
    }
    const [indexes]=await pool.query('SELECT TABLE_NAME t,INDEX_NAME i,COLUMN_NAME c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND NON_UNIQUE=0 ORDER BY SEQ_IN_INDEX');
    for(const [table,index,columns]of [['session_families','PRIMARY',['id']],['refresh_credentials','PRIMARY',['id']],['session_security_events','PRIMARY',['id']],['session_families','uq_family_auth',['auth_session_id']],['refresh_credentials','uq_refresh_hash',['credential_hash']]])assert.deepEqual(indexes.filter(i=>i.t===table&&i.i===index).map(i=>i.c),columns);
    for(const [name,sql]of Object.entries(queries)){const [[row]]=await pool.query(sql);result.checks.push({name,sql,violations:row.n,status:row.n===0?'PASS':'FAIL'});console.log(name+': '+row.n+' violations');}
    fs.writeFileSync(path.join(__dirname,'step8-integrity-results.json'),JSON.stringify(result,null,2)+'\n');
    assert(result.checks.every(c=>c.status==='PASS'),'Existing integrity violations found; no records changed.');console.log('PASS: read-only integrity, migration checksums, 22 tables and 20 triggers.');
  }finally{await pool.end();}
})().catch(error=>{console.error(error.code||error.message);process.exitCode=1;});
