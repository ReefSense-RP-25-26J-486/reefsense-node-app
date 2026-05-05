
require('dotenv').config();
const { Pool } = require('pg');

const dsn = (process.env.DATABASE_URL || '').trim();

if (!dsn) {
  throw new Error('DATABASE_URL is not set. Add it to your .env file or HF Space secrets.');
}

// Strip sslmode from URL — pg handles SSL via the ssl option below
const cleanDsn = dsn
  .replaceAll(/[?&]sslmode=[^&]*/g, '')
  .replace(/[?&]$/, '');

const pool = new Pool({
  connectionString:      cleanDsn,
  ssl:                   { rejectUnauthorized: false }, // NOSONAR — self-signed cert expected on managed DB host
  max:                   10,
  idleTimeoutMillis:     30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', err => console.error('[DB] Unexpected pool error:', err.message));

module.exports = pool;
