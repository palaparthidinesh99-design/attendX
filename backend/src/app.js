const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const { query } = require('./config/db');
const { notFoundHandler, errorHandler } = require('./middlewares/error');

const authRoutes = require('./routes/auth');
const courseRoutes = require('./routes/courses');
const sessionRoutes = require('./routes/sessions');
const attendanceRoutes = require('./routes/attendance');

const app = express();

// Trust reverse proxy headers (Render, Railway, Nginx)
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
        connectSrc: ["'self'", "*"]
      }
    }
  })
);

// ── Rate Limiters ───────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: 'Too many requests from this IP, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test'
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Too many login/register attempts, please try again in a few minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test'
});

const scanLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 300,
  message: { error: 'Too many attendance submissions. Slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test'
});

app.use('/api', globalLimiter);
app.use('/api/auth', authLimiter);
app.use('/api/attendance/scan', scanLimiter);

// ── Standard Middleware ─────────────────────────────────────────────────────
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// Static frontend serving
const frontendDist = path.resolve(__dirname, '../../frontend/dist');
const frontendPath = path.resolve(__dirname, '../../frontend');

if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
}
app.use(express.static(frontendPath));

// ── Health Check Endpoint ───────────────────────────────────────────────────
const healthCheckHandler = async (req, res) => {
  let dbStatus = 'disconnected';
  let isHealthy = false;

  try {
    await query('SELECT 1');
    dbStatus = 'connected';
    isHealthy = true;
  } catch (err) {
    dbStatus = 'error: ' + err.message;
  }

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'UP' : 'DOWN',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    database: dbStatus,
    engine: 'PostgreSQL',
    environment: process.env.NODE_ENV || 'development'
  });
};

app.get('/health', healthCheckHandler);
app.get('/api/health', healthCheckHandler);

// ── API Routes ──────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/attendance', attendanceRoutes);

// ── SPA Fallback (serve frontend index.html for non-API routes) ──────────────
app.get(/^(?!\/api).*/, (req, res) => {
  const distIndex = path.join(frontendDist, 'index.html');
  const srcIndex = path.join(frontendPath, 'index.html');
  if (fs.existsSync(distIndex)) {
    return res.sendFile(distIndex);
  }
  res.sendFile(srcIndex);
});

// ── Error Handling ──────────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
