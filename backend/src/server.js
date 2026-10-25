require('dotenv').config();
const app = require('./app');
const { initDB, getPool } = require('./config/db');

const PORT = process.env.PORT || 3000;
let server;

async function startServer() {
  try {
    // Ensure database connection and schema tables exist
    await initDB();

    server = app.listen(PORT, () => {
      console.log(`🚀 AttendX Backend Server listening on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
      console.log(`🐘 Powered by PostgreSQL`);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use.`);
      } else {
        console.error('❌ Server startup error:', err.message);
      }
      process.exit(1);
    });
  } catch (err) {
    console.error('❌ Failed to start server due to database error:', err.message);
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    } else {
      // In development, start server anyway so health endpoint can report DB error
      server = app.listen(PORT, () => {
        console.warn(`⚠️ Server listening on port ${PORT} with DB disconnected. Check your DATABASE_URL in .env`);
      });
    }
  }
}

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

// Graceful Shutdown
const gracefulShutdown = async (signal) => {
  console.log(`\n⚠️ Received ${signal}. Shutting down gracefully...`);
  if (server) {
    server.close(async () => {
      console.log('  🔒 HTTP server closed');
      try {
        const pool = getPool();
        if (pool) await pool.end();
        console.log('  🔒 PostgreSQL connection pool closed');
      } catch (_) {}
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = server;
