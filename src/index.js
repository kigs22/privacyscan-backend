// src/index.js — PrivacyScan Backend Server
require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const cron       = require('node-cron');
const fs         = require('fs');

const logger     = require('./utils/logger');
const { corsOptions, generalLimiter, paymentLimiter, rawBodyMiddleware, morganMiddleware } = require('./middleware');
const creditsSvc = require('./services/credits');

const app  = express();
const PORT = process.env.PORT || 3000;

// Ensure logs directory exists
if (!fs.existsSync('logs')) fs.mkdirSync('logs');

// ── Global Middleware ──────────────────────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors(corsOptions));
app.use(morganMiddleware);
app.use(generalLimiter);

// Raw body capture for webhooks (before JSON parser)
app.use(rawBodyMiddleware);

// JSON parser for all non-webhook routes
app.use((req, res, next) => {
  if (req.path.includes('/webhook') || req.path.includes('/callback')) {
    return next();
  }
  express.json({ limit: '1mb' })(req, res, next);
});
app.use(express.urlencoded({ extended: true }));

// ── Health check ───────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status:    'ok',
    service:   'PrivacyScan API',
    version:   '1.0.0',
    timestamp: new Date().toISOString(),
    env:       process.env.NODE_ENV,
  });
});

// ── Routes ─────────────────────────────────────────────────────────────────────
const BASE = '/privacyscan';
app.use(`${BASE}/payments`,   require('./routes/payments'));
app.use(`${BASE}/credits`,    require('./routes/credits'));
app.use(`${BASE}/affiliates`, require('./routes/affiliates'));
app.use(`${BASE}/packages`,   require('./routes/packages'));
app.use(`${BASE}/scans`,      require('./routes/scans'));
app.use(`${BASE}/auth`, require('./routes/auth'));
app.use(`${BASE}/admin`, require('./routes/admin'));

// ── 404 ────────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` });
});

// ── Error handler ──────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { message: err.message, path: req.path });
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

// ── Cron: expire stale credits every hour ──────────────────────────────────────
cron.schedule('0 * * * *', async () => {
  try {
    const count = await creditsSvc.expireStaleCredits();
    if (count > 0) logger.info(`Cron: expired ${count} credit records`);
  } catch (err) {
    logger.error('Cron job error', { err: err.message });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`PrivacyScan API running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Base URL: ${process.env.API_BASE_URL}`);
});

module.exports = app;
// force rebuild Thu Jul  9 20:59:39 EAST 2026
