'use strict';
require('../src/config/environment')();
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const security = require('../src/config/security');
const { setup } = require('../src/index');

(async () => {
  const env = { NODE_ENV: 'development', DB_HOST: '127.0.0.1', DB_PORT: '3306',
    CLIENT_ORIGIN: 'http://localhost:5500,http://127.0.0.1:5500,' + security.extensionOrigin };
  assert.equal(security.host, '127.0.0.1');
  assert.deepEqual(security.local(env).origins, env.CLIENT_ORIGIN.split(','));
  for (const patch of [
    { NODE_ENV: 'production' }, { DB_HOST: '0.0.0.0' }, { DB_HOST: '192.0.2.1' },
    { DB_PORT: '3307' }, { CLIENT_ORIGIN: 'https://classence.test' },
    { CLIENT_ORIGIN: 'http://192.0.2.1:5500' }, { CLIENT_ORIGIN: 'http://localhost.evil.test:5500' },
    { CLIENT_ORIGIN: 'chrome-extension://' + 'a'.repeat(32) },
    { CLIENT_ORIGIN: 'http://user@localhost:5500' }, { CLIENT_ORIGIN: 'http://localhost:5500/path' }
  ]) assert.throws(() => security.local({ ...env, ...patch }), /Setup error/);
  const server = http.createServer(setup({ pool: {} }).app);
  try {
    await new Promise(resolve => server.listen(0, security.host, resolve));
    assert.equal(server.address().address, '127.0.0.1');
    const base = 'http://127.0.0.1:' + server.address().port;
    assert.equal((await fetch(base + '/api/health')).status, 200);
    assert.equal((await fetch(base + '/')).status, 404);
    assert.equal((await fetch(base + '/api/health', { headers: { Origin: 'https://classence.test' } })).status, 403);
    assert.equal((await fetch(base + '/api/health', { headers: { Origin: security.extensionOrigin } })).status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); }
  const index = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');
  assert(index.includes('server.listen(port,security.host,'));
  assert(!/facultyAssets|BIND_HOST|scripts\/deployment/.test(index));
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../frontend/student/manifest.json')));
  assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1/*', 'https://meet.google.com/*']);
  console.log('PASS: loopback bind, local-only configuration/origins, approved extension, API health, no Faculty hosting, no deployment configuration or tunnel required.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
