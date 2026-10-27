'use strict';
const host = '127.0.0.1';
const extensionOrigin = 'chrome-extension://jefdcdmlgafknafmpdondeglcbimdnki';

function allowedOrigin(origin) {
 if (origin === extensionOrigin) return true;
 try {
  const url = new URL(origin);
  return url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) &&
   url.origin === origin && !url.username && !url.password && !url.search && !url.hash;
 } catch { return false; }
}

function local(env = process.env) {
 if (!['development', 'test'].includes(env.NODE_ENV)) throw Error('Setup error: NODE_ENV must be development or test for this localhost-only prototype.');
 if (env.DB_HOST !== host || Number(env.DB_PORT) !== 3306) throw Error('Setup error: MySQL must use 127.0.0.1:3306.');
 const origins = String(env.CLIENT_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean);
 if (!origins.length || origins.some(origin => !allowedOrigin(origin))) throw Error('Setup error: CLIENT_ORIGIN must contain only explicit local HTTP origins and the approved Student Extension origin.');
 return { origins };
}
function headers(){return require('helmet')({strictTransportSecurity:false,contentSecurityPolicy:{useDefaults:false,directives:{defaultSrc:["'none'"],baseUri:["'none'"],formAction:["'none'"],frameAncestors:["'none'"]}}});}
module.exports = { local, headers, allowedOrigin, host, extensionOrigin };
