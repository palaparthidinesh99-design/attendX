require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const authRoutes = require('./routes/auth');
const courseRoutes = require('./routes/courses');
const sessionRoutes = require('./routes/sessions');
const attendanceRoutes = require('./routes/attendance');

// ── Environment Validation ──────────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/attendance_system';
const JWT_SECRET = process.env.JWT_SECRET || 'dev_fallback_secret_key_12345';
const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16)) {
  console.error('❌ FATAL: Insecure or missing JWT_SECRET in production mode.');
  process.exit(1);
}

const app = express();

// Trust reverse proxy headers (Render, Railway, Heroku, Nginx, AWS ALB)
app.set('trust proxy', 1);

// ── Security Headers ────────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://unpkg.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"]
      }
    }
  })
);

// ── Rate Limiters ───────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  message: { error: 'Too many requests from this IP, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50, // 50 attempts per 15 min
  message: { error: 'Too many login/register attempts, please try again in a few minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

const scanLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 15, // 15 scan attempts per min
  message: { error: 'Too many attendance submission attempts. Slow down.' },
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api', globalLimiter);
app.use('/api/auth', authLimiter);
app.use('/api/attendance/scan', scanLimiter);

// ── Standard Middleware ─────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, '../public')));

// ── Health Check Endpoint (QA & Cloud Monitoring) ──────────────────────────
const healthCheckHandler = (req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbStatus = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' }[dbState] || 'unknown';
  const isHealthy = dbState === 1;

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'UP' : 'DOWN',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    database: dbStatus,
    environment: process.env.NODE_ENV || 'development'
  });
};

app.get('/health', healthCheckHandler);
app.get('/api/health', healthCheckHandler);

// ── API Routes ─────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/attendance', attendanceRoutes);

// ── SPA Fallback (serve frontend for all non-API routes) ───────────────────
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── Global Error Handler ───────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] ${err.stack || err.message}`);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

// ── Database Connection & Server Bootstrap ─────────────────────────────────
let server;

async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    console.log('✅ Connected to MongoDB (Atlas)');
  } catch (atlasErr) {
    console.warn(`⚠️ MongoDB Atlas Connection Timeout: ${atlasErr.message}`);
    console.log('🔄 Attempting fallback connection to local MongoDB (mongodb://127.0.0.1:27017/attendence_system)...');
    try {
      await mongoose.connect('mongodb://127.0.0.1:27017/attendance_system', { serverSelectionTimeoutMS: 5000 });
      console.log('✅ Connected to Local MongoDB');
    } catch (localErr) {
      console.error('❌ FATAL: Could not connect to MongoDB Atlas or Local MongoDB.');
      console.error('  Atlas error:', atlasErr.message);
      console.error('  Local error:', localErr.message);
      process.exit(1);
    }
  }
}

if (process.env.NODE_ENV !== 'test') {
  connectDB().then(() => {
    server = app.listen(PORT, () => {
      console.log(`🚀 Server listening on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
    });
    server.on('error', err => {
      if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use by another process. Clear it with: lsof -ti :${PORT} | xargs kill -9`);
      } else {
        console.error('❌ Server error:', err.message);
      }
      process.exit(1);
    });
  });
}

// ── Graceful Shutdown Handler ──────────────────────────────────────────────
const gracefulShutdown = signal => {
  console.log(`\n⚠️ Received ${signal}. Initiating graceful shutdown...`);
  if (server) {
    server.close(() => {
      console.log('  🔒 HTTP server closed');
      mongoose.connection.close(false, () => {
        console.log('  🔒 MongoDB connection closed');
        process.exit(0);
      });
    });
  } else {
    process.exit(0);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = app;
