'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const suites = [
  'authentication.cjs', 'faculty-integration.cjs', 'student-integration.cjs',
  'realtime.cjs', 'realtime-browser.cjs', 'meet-monitoring.cjs', 'meet-worker.cjs',
  'meet-monitoring-browser.cjs', 'end-to-end.cjs', 'faculty-class-attendance.cjs',
  'automatic-attendance.cjs', 'faculty-records-browser.cjs', 'faculty-profile.cjs', 'step8-frontend.cjs',
  'security-http.cjs', 'security-api.cjs', 'secure-session-renewal.cjs',
  'renewal-concurrency.cjs', 'recovery-api.cjs', 'recovery-clients.cjs',
  'recovery-worker.cjs', 'recovery-process.cjs', 'privacy-api.cjs', 'privacy-browser.cjs',
  'operations.cjs', 'operations-isolated.cjs', 'backup-restore.cjs',
  'student-popup.cjs', 'local-config.cjs', 'readiness-multi.cjs', 'step8-integrity.cjs', 'dependency-audit.cjs'
];

(async () => {
  const selected = process.argv.slice(2);
  const results = { startedAt: new Date().toISOString(), results: [] };
  for (const file of selected.length ? selected : suites) {
    if (!suites.includes(file)) throw Error('Unknown cleanup suite: ' + file);
    const start = Date.now();
    const child = spawn(process.execPath, [path.join(__dirname, file)], {
      cwd: path.join(__dirname, '..'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '', timedOut = false;
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 240000);
    const exitCode = await new Promise((resolve, reject) => {
      child.once('close', resolve);
      child.once('error', reject);
    });
    clearTimeout(timer);
    results.results.push({ file, exitCode, timedOut, seconds: (Date.now() - start) / 1000,
      output: output.replace(/\b[a-f0-9]{64}\b/gi, '[redacted]') });
    fs.writeFileSync(path.join(__dirname, 'cleanup-results.json'), JSON.stringify(results, null, 2) + '\n');
    console.log(`${file}: ${exitCode === 0 && !timedOut ? 'PASS' : 'FAIL'} (${results.results.at(-1).seconds}s)`);
    if (exitCode !== 0 || timedOut) console.log(results.results.at(-1).output);
  }
  results.finishedAt = new Date().toISOString();
  results.summary = { suites: results.results.length,
    passed: results.results.filter(r => r.exitCode === 0 && !r.timedOut).length,
    failed: results.results.filter(r => r.exitCode !== 0 || r.timedOut).length };
  fs.writeFileSync(path.join(__dirname, 'cleanup-results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results.summary));
  process.exitCode = results.summary.failed ? 1 : 0;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
