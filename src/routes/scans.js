// src/routes/scans.js
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Log a completed scan event (analytics)
router.post('/log', async (req, res) => {
  try {
    const { deviceId, scanType, result, alertCount, countryCode } = req.body;
    if (!deviceId || !scanType || !result) {
      return res.status(400).json({ success: false, message: 'deviceId, scanType and result required' });
    }
    await prisma.scanEvent.create({
      data: {
        deviceId,
        scanType,
        result,
        alertCount: alertCount || 0,
        countryCode: countryCode || null,
      },
    });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Get scan stats for a device
router.get('/:deviceId', async (req, res) => {
  try {
    const events = await prisma.scanEvent.findMany({
      where:   { deviceId: req.params.deviceId },
      orderBy: { createdAt: 'desc' },
      take:    50,
    });
    const threatCount = events.filter(e => e.result === 'threat').length;
    return res.json({ success: true, events, threatCount, totalScans: events.length });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
