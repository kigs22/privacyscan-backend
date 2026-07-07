// src/routes/packages.js
const router     = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// List all active packages (used by app on load)
router.get('/', async (req, res) => {
  try {
    const packages = await prisma.package.findMany({
      where:   { isActive: true },
      orderBy: { priceKES: 'asc' },
    });
    return res.json({ success: true, packages });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
