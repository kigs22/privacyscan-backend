// src/middleware/index.js
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');
const logger     = require('../utils/logger');

// ── CORS ───────────────────────────────────────────────────────────────────────
const corsOptions = {
  origin: [
    'https://www.pesagate.com',
    'https://pesagate.com',
    'https://downloads.pesagate.co.ke',
    // Add your Railway/Render URL here during development
    /^http:\/\/localhost/,
  ],
  methods:      ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders:['Content-Type', 'Authorization', 'x-admin-key', 'x-device-id'],
  credentials:  true,
};

// ── RATE LIMITS ────────────────────────────────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max:      100,
  message:  { success: false, message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

const paymentLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max:      5,          // max 5 payment initiations per minute per IP
  message:  { success: false, message: 'Too many payment requests. Please wait a moment.' },
});

// ── RAW BODY FOR WEBHOOKS ──────────────────────────────────────────────────────
// Paystack webhook signature validation needs the raw body
const rawBodyMiddleware = (req, res, next) => {
  if (req.path.includes('/webhook') || req.path.includes('/callback')) {
    let rawData = '';
    req.on('data', chunk => { rawData += chunk; });
    req.on('end', () => {
      req.rawBody = rawData;
      try {
        req.body = JSON.parse(rawData);
      } catch {
        req.body = {};
      }
      next();
    });
  } else {
    next();
  }
};

// ── MORGAN HTTP LOGGER ─────────────────────────────────────────────────────────
const morganMiddleware = morgan(
  ':method :url :status :res[content-length] - :response-time ms',
  {
    stream: { write: (msg) => logger.http(msg.trim()) },
    skip:   (req) => req.path === '/health', // skip health check logs
  }
);

module.exports = {
  corsOptions,
  generalLimiter,
  paymentLimiter,
  rawBodyMiddleware,
  morganMiddleware,
};
