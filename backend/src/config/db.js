const { Pool } = require('pg');

let pool;
let isInMemory = false;

function createPool() {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

  // For testing when no DB is provided, spin up in-memory PostgreSQL emulator
  if (process.env.NODE_ENV === 'test' && !connectionString && !process.env.DB_HOST && !process.env.PGHOST) {
    try {
      const { newDb } = require('pg-mem');
      const db = newDb();
      // Register pgcrypto extension and gen_random_uuid
      db.registerExtension('pgcrypto', (schema) => {
        schema.registerFunction({
          name: 'gen_random_uuid',
          impure: true,
          returns: db.public.uuid,
          implementation: () => require('crypto').randomUUID()
        });
      });
      db.public.registerFunction({
        name: 'gen_random_uuid',
        impure: true,
        returns: db.public.uuid,
        implementation: () => require('crypto').randomUUID()
      });
      const pgAdapter = db.adapters.createPg();
      pool = new pgAdapter.Pool();
      isInMemory = true;
      console.log('⚡ Initialized in-memory PostgreSQL test instance');
      return pool;
    } catch (err) {
      console.warn('⚠️ pg-mem fallback not available:', err.message);
    }
  }

  const isRemote = connectionString && !connectionString.includes('localhost') && !connectionString.includes('127.0.0.1');

  if (connectionString) {
    pool = new Pool({
      connectionString,
      ssl: isRemote ? { rejectUnauthorized: false } : false
    });
  } else {
    pool = new Pool({
      user: process.env.DB_USER || process.env.PGUSER || 'postgres',
      host: process.env.DB_HOST || process.env.PGHOST || 'localhost',
      database: process.env.DB_NAME || process.env.PGDATABASE || 'attendx',
      password: process.env.DB_PASSWORD || process.env.PGPASSWORD || 'postgres',
      port: parseInt(process.env.DB_PORT || process.env.PGPORT || 5432, 10),
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
    });
  }

  pool.on('error', (err) => {
    console.error('❌ Unexpected error on idle PostgreSQL client:', err);
  });

  return pool;
}

function getPool() {
  if (!pool) {
    createPool();
  }
  return pool;
}

async function query(text, params) {
  const p = getPool();
  return p.query(text, params);
}

/**
 * Initializes schema and tables from the simple practical schema.
 */
async function initDB() {
  const p = getPool();
  
  // Create tables according to user schema
  const extSQL = `CREATE EXTENSION IF NOT EXISTS pgcrypto;`;
  const schemaSQL = `
    CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('student', 'teacher', 'admin')),
        current_challenge TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS webauthn_credentials (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        credential_id TEXT NOT NULL UNIQUE,
        public_key TEXT NOT NULL,
        counter BIGINT NOT NULL DEFAULT 0,
        transports JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_webauthn_user ON webauthn_credentials(user_id);

    CREATE TABLE IF NOT EXISTS courses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        course_code TEXT NOT NULL UNIQUE,
        teacher_id UUID NOT NULL REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS enrollments (
        course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (course_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        created_by UUID NOT NULL REFERENCES users(id),
        starts_at TIMESTAMPTZ NOT NULL,
        ends_at TIMESTAMPTZ NOT NULL,
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        radius_meters INTEGER NOT NULL DEFAULT 50 CHECK (radius_meters > 0),
        qr_secret_encrypted TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CHECK (starts_at < ends_at),
        CHECK (
            (latitude IS NULL AND longitude IS NULL)
            OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
        )
    );

    CREATE TABLE IF NOT EXISTS attendance (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        marked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        status TEXT NOT NULL DEFAULT 'present'
            CHECK (status IN ('present', 'late', 'excused')),
        distance_meters DOUBLE PRECISION,
        UNIQUE (session_id, student_id),
        CHECK (distance_meters IS NULL OR distance_meters >= 0)
    );

    CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id, marked_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_course ON sessions(course_id, starts_at DESC);
  `;

  try {
    try {
      await p.query(extSQL);
    } catch (e) {
      // In some environments / pg-mem, extension is built-in
    }
    await p.query(schemaSQL);
    try {
      await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS current_challenge TEXT;`);
    } catch (_) {}
    console.log('✅ PostgreSQL Schema initialized successfully');
  } catch (err) {
    console.error('❌ Failed to initialize PostgreSQL Schema:', err.message);
    throw err;
  }
}

module.exports = {
  getPool,
  query,
  initDB,
  isInMemory: () => isInMemory
};
