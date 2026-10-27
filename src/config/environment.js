'use strict';

module.exports = () => {
 require('dotenv').config({ path: require('node:path').join(__dirname, '../../.env'), quiet: true });
 process.env.NODE_ENV ??= 'development';
 process.env.PORT ??= '3000';
 process.env.DB_HOST ??= '127.0.0.1';
 process.env.DB_PORT ??= '3306';
};
