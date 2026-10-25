require('dotenv').config();
const { getPool, query } = require('../src/config/db');

async function checkPostgresConnection() {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  console.log('🔍 Testing connection to PostgreSQL Database...');
  console.log('  Target URL:', dbUrl ? dbUrl.replace(/:([^@]+)@/, ':****@') : 'localhost:5432 (default)');

  const start = Date.now();
  try {
    const res = await query('SELECT version(), current_database()');
    const elapsed = Date.now() - start;

    console.log(`\n✅ CONNECTED TO POSTGRESQL (${elapsed}ms)!`);
    console.log('  Database:', res.rows[0].current_database);
    console.log('  Version:', res.rows[0].version);

    const tablesRes = await query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);

    console.log(`\n📁 Total Public Tables: ${tablesRes.rows.length}`);
    for (const row of tablesRes.rows) {
      const countRes = await query(`SELECT COUNT(*) FROM "${row.table_name}"`);
      console.log(`  └─ Table '${row.table_name}': ${countRes.rows[0].count} row(s)`);
    }

    const pool = getPool();
    if (pool) await pool.end();
    console.log('\n🔒 Connection closed cleanly.');
    process.exit(0);
  } catch (err) {
    const elapsed = Date.now() - start;
    console.error(`\n❌ FAILED TO CONNECT TO POSTGRESQL (${elapsed}ms)`);
    console.error('  Error Message:', err.message);
    process.exit(1);
  }
}

checkPostgresConnection();
