// src/routes/payments.js — Paystack only
const router     = require('express').Router();
const controller = require('../controllers/paymentController');
const { paymentLimiter } = require('../middleware');
const { body, param, validationResult } = require('express-validator');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  next();
};

// ── Initiate payment (card / M-Pesa / Airtel via Paystack) ────────────────────
router.post('/initiate',
  paymentLimiter,
  [
    body('email').isEmail().withMessage('Valid email required'),
    body('packageId').notEmpty().withMessage('packageId required'),
    body('deviceId').notEmpty().withMessage('deviceId required'),
  ],
  validate,
  controller.initiatePayment
);

// ── Verify payment after user returns from Paystack ───────────────────────────
router.get('/verify/:reference',
  param('reference').notEmpty(),
  validate,
  controller.verifyPayment
);

// ── Paystack webhook (server-to-server — most reliable) ───────────────────────
router.post('/webhook', controller.paystackWebhook);

// ── Browser callback after payment (Paystack redirects here) ─────────────────
router.get('/callback', controller.paystackCallback);

module.exports = router;
