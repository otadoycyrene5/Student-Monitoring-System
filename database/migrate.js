'use strict';
require('../src/config/environment')();
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const pool = require('../src/config/database');
const operational=require('../src/operations');
const fingerprint = createSql => crypto.createHash('sha256').update(createSql.replace(/ AUTO_INCREMENT=\d+/g, '')).digest('hex');
async function migrate() {
  const connection = await pool.getConnection();
  let locked = false;
  const identity=crypto.createHash('sha256').update([process.env.DB_HOST,process.env.DB_PORT,process.env.DB_NAME].join(':')).digest('hex').slice(0,20);
  const journal=path.join(__dirname,'.migration-journal-'+identity+'.json');
  try {
    await connection.query("SET time_zone = '+00:00'");
    await connection.query("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'");
    const [[version]] = await connection.query('SELECT VERSION() AS version');
    if (!/^8\./.test(version.version)) throw new Error('This migration requires MySQL 8.x.');
    const [[lock]] = await connection.execute('SELECT GET_LOCK(?, 10) AS acquired', ['classence_schema_migration']);
    if (lock.acquired !== 1) throw new Error('Another migration is running.'); locked = true;
    const directory=path.join(__dirname,'migrations');
    const files=fs.readdirSync(directory).filter(n=>/^\d+_.*\.sql$/.test(n)).sort();
    if(files.some((n,i)=>i&&Number(n.split('_')[0])<=Number(files[i-1].split('_')[0])))throw Error('Migration sequence is ambiguous.');
    const [present]=await connection.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='schema_migrations'");
    if(present.length){const [applied]=await connection.query('SELECT version,checksum FROM schema_migrations ORDER BY version');for(const row of applied){if(!files.includes(row.version)||row.checksum!==crypto.createHash('sha256').update(fs.readFileSync(path.join(directory,row.version),'utf8')).digest('hex'))throw Error('Applied migration checksum differs or file is missing.');}if(applied.some((r,i)=>r.version!==files[i]))throw Error('Applied migrations are not an ordered prefix.');}
    if(fs.existsSync(journal)){const record=JSON.parse(fs.readFileSync(journal,'utf8'));const [done]=present.length?await connection.execute('SELECT checksum FROM schema_migrations WHERE version=?',[record.file]):[[]];if(done[0]?.checksum===record.checksum)fs.unlinkSync(journal);else throw Error('Interrupted migration journal found. Inspect actual DDL and recover manually before removing the journal; automatic resume is refused.');}
    for (const file of fs.readdirSync(path.join(__dirname, 'migrations')).filter(name=>/^\d+_.*\.sql$/.test(name)).sort()) {
    const progressPath = path.join(__dirname, '.migration-progress-' + identity + '-' + file + '.json');
    const sql = fs.readFileSync(path.join(__dirname, 'migrations', file), 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    const names = [...sql.matchAll(/CREATE TABLE (\w+)/g)].map(match => match[1]);
    const triggers = [...sql.matchAll(/CREATE TRIGGER (\w+)/g)].map(match => match[1]);
    const [tables] = await connection.query('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');
    const existing = new Set(tables.map(row => row.name));
    if (existing.has('schema_migrations')) {
      const [applied] = await connection.execute('SELECT checksum FROM schema_migrations WHERE version=?', [file]);
      if (applied.length) {
        if (applied[0].checksum !== checksum) throw new Error('Applied migration checksum differs. Create a new migration; do not edit the applied file.');
        const [installed] = await connection.query('SELECT TRIGGER_NAME AS name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()');
        if (names.some(name => !existing.has(name)) || triggers.some(name => !installed.some(trigger => trigger.name === name))) throw new Error('Applied migration has missing tables or triggers. Investigate schema drift.');
        console.log(file+' already applied; checksum, tables and validation triggers verified.'); continue;
      }
    }
    operational.log('migration.started');
    let progress = { checksum, database: process.env.DB_NAME, tables: {}, triggers: [] };
    if (names.some(name => existing.has(name))) {
      if (!process.argv.includes('--resume') || !fs.existsSync(progressPath)) throw new Error('Schema conflict or incomplete migration. Inspect the database; resume only with a matching local progress record.');
      progress = JSON.parse(fs.readFileSync(progressPath, 'utf8'));
      if (progress.checksum !== checksum || progress.database !== process.env.DB_NAME) throw new Error('Progress record does not match this database/migration.');
      for (const name of names.filter(name => existing.has(name))) {
        const [[definition]] = await connection.query(`SHOW CREATE TABLE \`${name}\``);
        if (progress.tables[name] !== fingerprint(definition['Create Table'])) throw new Error('Partial schema drift detected; refusing resume.');
        const [[count]] = await connection.query(`SELECT COUNT(*) AS count FROM \`${name}\``);
        if (count.count !== 0) throw new Error('Partial schema contains records; investigate manually before resuming.');
      }
    }
    if (!existing.has('schema_migrations')) await connection.query('CREATE TABLE schema_migrations (version VARCHAR(100) PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
    for (const block of sql.split('-- statement-break')) {
      const statement = block.replace(/^--.*$/gm, '').replace(/^DELIMITER.*$/gm, '').trim().replace(/\$\$$/, '').replace(/;$/, '').trim();
      if (!statement) continue;
      const table = /^CREATE TABLE (\w+)/.exec(statement)?.[1];
      const trigger = /^CREATE TRIGGER (\w+)/.exec(statement)?.[1];
      if (table && progress.tables[table]) continue;
      if (trigger && progress.triggers.includes(trigger)) {
        const [found] = await connection.execute('SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME=?', [trigger]);
        if (!found.length) throw new Error('Partial trigger drift detected.');
        continue;
      }

      const descriptor=fs.openSync(journal,'w',0o600);try{fs.writeFileSync(descriptor,JSON.stringify({file,checksum,statementIndex:sql.split('-- statement-break').indexOf(block),state:'IN_FLIGHT'}));fs.fsyncSync(descriptor);}finally{fs.closeSync(descriptor);}
      await connection.query(statement);
      if (table) { const [[definition]] = await connection.query(`SHOW CREATE TABLE \`${table}\``); progress.tables[table] = fingerprint(definition['Create Table']); }
      if (trigger) progress.triggers.push(trigger);
      fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2));
    }
    await connection.execute('INSERT INTO schema_migrations(version,checksum) VALUES (?,?)', [file, checksum]);
    fs.unlinkSync(journal);operational.log('migration.completed');
    console.log(`Applied ${file}: ${names.length} tables, ${triggers.length} validation triggers; no existing data deleted.`);
    }
  } finally {
    try{if (locked) await connection.execute('SELECT RELEASE_LOCK(?)', ['classence_schema_migration']);}finally{connection.release();}
  }
}
migrate().catch(error => { operational.log('migration.failed',{code:/^[A-Z0-9_]+$/.test(error.code||'')?error.code:'MIGRATION_ERROR'}); console.error(error.code ? `Migration failed [${error.code}]. DDL may be partially applied: inspect the database; do not reset or drop tables.` : error.message); process.exitCode = 1; }).finally(() => pool.end());
