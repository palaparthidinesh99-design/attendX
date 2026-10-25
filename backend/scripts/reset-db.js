require('dotenv').config();
const { getPool, query, initDB } = require('../src/config/db');

async function resetDatabase() {
  console.log('🧹 Resetting PostgreSQL database tables...');
  try {
    await query(`
      DROP TABLE IF EXISTS attendance CASCADE;
      DROP TABLE IF EXISTS sessions CASCADE;
      DROP TABLE IF EXISTS enrollments CASCADE;
      DROP TABLE IF EXISTS courses CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
    `);
    console.log('  └─ Dropped existing tables');

    await initDB();
    console.log('✅ PostgreSQL Schema re-initialized successfully!');

    const pool = getPool();
    if (pool) await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('❌ Failed to reset database:', err.message);
    process.exit(1);
  }
}

resetDatabase();
