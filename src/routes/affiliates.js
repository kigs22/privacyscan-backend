// src/routes/affiliates.js
const router = require('express').Router();
const affSvc = require('../services/affiliate');
const { body, validationResult } = require('express-validator');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  next();
};

// Apply to join affiliate program (from app or website form)
router.post('/apply',
  [
    body('name').notEmpty().withMessage('Name required'),
    body('email').isEmail().withMessage('Valid email required'),
    body('payoutMethod')
      .isIn(['mpesa','bank','paypal','paystack'])
      .withMessage('Invalid payout method'),
  ],
  validate,
  async (req, res) => {
    try {
      const affiliate = await affSvc.createApplication(req.body);
      return res.status(201).json({
        success: true,
        code:    affiliate.code,
        message: 'Application received. You will be notified within 48 hours.',
      });
    } catch (err) {
      if (err.code === 'P2002') {
        return res.status(409).json({ success: false, message: 'Email already registered.' });
      }
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

// Get affiliate performance stats
router.get('/stats/:code', async (req, res) => {
  try {
    const stats = await affSvc.getStats(req.params.code);
    if (!stats) return res.status(404).json({ success: false, message: 'Affiliate not found' });
    return res.json({ success: true, ...stats });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Validate referral code (called by app at checkout)
router.get('/validate/:code', async (req, res) => {
  try {
    const affiliate = await affSvc.validateCode(req.params.code);
    if (!affiliate) return res.json({ valid: false });
    return res.json({
      valid:          true,
      name:           affiliate.name,
      commissionRate: affiliate.commissionRate,
    });
  } catch (err) {
    return res.status(500).json({ valid: false, message: err.message });
  }
});

module.exports = router;
