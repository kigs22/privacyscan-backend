// src/routes/credits.js
const router     = require('express').Router();
const creditsSvc = require('../services/credits');
const logger     = require('../utils/logger');

// Get active credits for a device
router.get('/:deviceId', async (req, res) => {
  try {
    const credits = await creditsSvc.getCredits(req.params.deviceId);
    return res.json({ success: true, ...credits });
  } catch (err) {
    logger.error('Get credits error', { err: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Consume one scan credit (called before each scan from the app)
router.post('/:deviceId/consume', async (req, res) => {
  try {
    const result = await creditsSvc.consumeCredit(req.params.deviceId);
    if (!result.success) {
      return res.status(402).json({ success: false, message: result.reason });
    }
    return res.json({ success: true, remaining: result.remaining });
  } catch (err) {
    logger.error('Consume credit error', { err: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
