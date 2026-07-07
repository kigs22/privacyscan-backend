// src/routes/admin.js
const router     = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const prisma     = new PrismaClient();
const affSvc     = require('../services/affiliate');
const creditsSvc = require('../services/credits');
const logger     = require('../utils/logger');

// ── Admin API key auth ─────────────────────────────────────────────────────────
const adminAuth = (req, res, next) => {
  const key = req.headers['x-admin-key'];
  if (!key || key !== process.env.API_SECRET) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  next();
};

router.use(adminAuth);

// ── Dashboard stats ────────────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const [
      revenueData,
      totalTransactions,
      activeCredits,
      pendingAffiliates,
      approvedAffiliates,
      totalScanEvents,
      threatScans,
      revenueByPackage,
    ] = await Promise.all([
      prisma.transaction.aggregate({
        where: { paymentStatus: 'success' },
        _sum:  { amountKES: true },
      }),
      prisma.transaction.count({ where: { paymentStatus: 'success' } }),
      prisma.credit.count({ where: { isActive: true } }),
      prisma.affiliate.count({ where: { status: 'pending' } }),
      prisma.affiliate.count({ where: { status: 'approved' } }),
      prisma.scanEvent.count(),
      prisma.scanEvent.count({ where: { result: 'threat' } }),
      prisma.transaction.groupBy({
        by:    ['packageId'],
        where: { paymentStatus: 'success' },
        _sum:  { amountKES: true },
        _count:{ id: true },
      }),
    ]);

    return res.json({
      success:            true,
      totalRevenueKES:    revenueData._sum.amountKES || 0,
      totalTransactions,
      activeCredits,
      pendingAffiliates,
      approvedAffiliates,
      totalScanEvents,
      threatScanPercent:  totalScanEvents > 0
        ? Math.round((threatScans / totalScanEvents) * 100)
        : 0,
      revenueByPackage,
    });
  } catch (err) {
    logger.error('Admin stats error', { err: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── Transactions ───────────────────────────────────────────────────────────────
router.get('/transactions', async (req, res) => {
  try {
    const page    = parseInt(req.query.page    || 1);
    const perPage = parseInt(req.query.perPage || 20);
    const status  = req.query.status;

    const where = status ? { paymentStatus: status } : {};

    const [txns, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        skip:    (page - 1) * perPage,
        take:    perPage,
        orderBy: { createdAt: 'desc' },
        include: { package: true },
      }),
      prisma.transaction.count({ where }),
    ]);

    return res.json({ success: true, transactions: txns, total, page, perPage });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── Affiliates ─────────────────────────────────────────────────────────────────
router.get('/affiliates', async (req, res) => {
  try {
    const status = req.query.status || undefined;
    const affiliates = await prisma.affiliate.findMany({
      where:   status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { transactions: true } } },
    });
    return res.json({ success: true, affiliates });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/affiliates/:id/approve', async (req, res) => {
  try {
    const affiliate = await affSvc.approveAffiliate(req.params.id);
    logger.info('Affiliate approved', { id: req.params.id, code: affiliate.code });
    return res.json({ success: true, affiliate });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/affiliates/:id/suspend', async (req, res) => {
  try {
    const affiliate = await prisma.affiliate.update({
      where: { id: req.params.id },
      data:  { status: 'suspended' },
    });
    return res.json({ success: true, affiliate });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── Credits management ─────────────────────────────────────────────────────────
router.post('/credits/grant', async (req, res) => {
  try {
    const { deviceId, packageSlug, reason } = req.body;
    const pkg = await prisma.package.findUnique({ where: { slug: packageSlug } });
    if (!pkg) return res.status(404).json({ success: false, message: 'Package not found' });

    // Create a dummy transaction for tracking
    const txn = await prisma.transaction.create({
      data: {
        reference:     `ADMIN-GRANT-${Date.now()}`,
        deviceId,
        amountKES:     0,
        currency:      'KES',
        amountLocal:   0,
        packageId:     pkg.id,
        paymentMethod: 'admin_grant',
        paymentStatus: 'success',
      },
    });

    const credit = await creditsSvc.issueCredits({
      deviceId,
      packageId:     pkg.id,
      transactionId: txn.id,
    });

    logger.info('Admin credit grant', { deviceId, packageSlug, reason });
    return res.json({ success: true, credit });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── Packages management ────────────────────────────────────────────────────────
router.patch('/packages/:id', async (req, res) => {
  try {
    const { priceKES, isActive, name } = req.body;
    const pkg = await prisma.package.update({
      where: { id: req.params.id },
      data:  { priceKES, isActive, name },
    });
    return res.json({ success: true, package: pkg });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── Force expire credits (maintenance) ────────────────────────────────────────
router.post('/credits/expire', async (req, res) => {
  try {
    const count = await creditsSvc.expireStaleCredits();
    return res.json({ success: true, expiredCount: count });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
