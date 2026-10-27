'use strict';

const mysql = require('mysql2/promise');
require('./security').local();

for (const key of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_NAME']) {
  if (!process.env[key]?.trim()) throw new Error(`Setup error: configure ${key} in backend/.env.`);
}
if (process.env.DB_PASSWORD === undefined) throw new Error('Setup error: define DB_PASSWORD in backend/.env (use your local account password).');
const port = Number(process.env.DB_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Setup error: DB_PORT must be an integer between 1 and 65535.');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  timezone: 'Z',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 20,
  connectTimeout: 5000,
  enableKeepAlive: true
});
pool.on('connection', connection => {
  connection.query("SET time_zone = '+00:00'", error => {
    if (error) { console.error('MySQL UTC session initialization failed.'); connection.destroy(); }
  });
});

module.exports = pool;
