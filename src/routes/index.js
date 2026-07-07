// src/routes/payments.js
const router     = require('express').Router();
const controller = require('../controllers/paymentController');
const { body, param, validationResult } = require('express-validator');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  next();
};

// Paystack
router.post('/initiate',
  [
    body('email').isEmail().withMessage('Valid email required'),
    body('packageId').notEmpty().withMessage('packageId required'),
    body('deviceId').notEmpty().withMessage('deviceId required'),
  ],
  validate,
  controller.initiatePaystack
);

router.get('/verify/:reference',
  param('reference').notEmpty(),
  validate,
  controller.verifyPaystack
);

router.post('/paystack/webhook', controller.paystackWebhook);

// M-Pesa
router.post('/mpesa',
  [
    body('phone').notEmpty().withMessage('Phone number required'),
    body('packageId').notEmpty().withMessage('packageId required'),
    body('deviceId').notEmpty().withMessage('deviceId required'),
  ],
  validate,
  controller.initiateMpesa
);

router.get('/mpesa/status/:checkoutRequestId',
  param('checkoutRequestId').notEmpty(),
  validate,
  controller.mpesaStatus
);

router.post('/mpesa/callback', controller.mpesaCallback);

module.exports = router;


// ─────────────────────────────────────────────────────────────────────────────
// src/routes/credits.js
const creditsRouter  = require('express').Router();
const creditsSvc     = require('../services/credits');
const logger2        = require('../utils/logger');

// Get credits for a device
creditsRouter.get('/:deviceId', async (req, res) => {
  try {
    const credits = await creditsSvc.getCredits(req.params.deviceId);
    return res.json({ success: true, ...credits });
  } catch (err) {
    logger2.error('Get credits error', { err: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Consume one credit (called before each scan)
creditsRouter.post('/:deviceId/consume', async (req, res) => {
  try {
    const result = await creditsSvc.consumeCredit(req.params.deviceId);
    if (!result.success) {
      return res.status(402).json({ success: false, message: result.reason });
    }
    return res.json({ success: true, remaining: result.remaining });
  } catch (err) {
    logger2.error('Consume credit error', { err: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = creditsRouter;


// ─────────────────────────────────────────────────────────────────────────────
// src/routes/affiliates.js
const affRouter  = require('express').Router();
const affSvc     = require('../services/affiliate');
const { body: affBody, validationResult: affValidate } = require('express-validator');

const vld = (req, res, next) => {
  const errors = affValidate(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  next();
};

// Apply to join affiliate program
affRouter.post('/apply',
  [
    affBody('name').notEmpty(),
    affBody('email').isEmail(),
    affBody('payoutMethod').isIn(['mpesa','bank','paypal','paystack']),
  ],
  vld,
  async (req, res) => {
    try {
      const affiliate = await affSvc.createApplication(req.body);
      return res.status(201).json({ success: true, code: affiliate.code, message: 'Application received. You will be notified within 48 hours.' });
    } catch (err) {
      if (err.code === 'P2002') { // Prisma unique constraint
        return res.status(409).json({ success: false, message: 'Email already registered.' });
      }
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

// Get affiliate stats by code
affRouter.get('/stats/:code', async (req, res) => {
  try {
    const stats = await affSvc.getStats(req.params.code);
    if (!stats) return res.status(404).json({ success: false, message: 'Affiliate not found' });
    return res.json({ success: true, ...stats });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Validate a referral code (used by app on checkout)
affRouter.get('/validate/:code', async (req, res) => {
  try {
    const affiliate = await affSvc.validateCode(req.params.code);
    if (!affiliate) return res.json({ valid: false });
    return res.json({ valid: true, name: affiliate.name, commissionRate: affiliate.commissionRate });
  } catch (err) {
    return res.status(500).json({ valid: false, message: err.message });
  }
});

module.exports = affRouter;


// ─────────────────────────────────────────────────────────────────────────────
// src/routes/packages.js
const pkgRouter  = require('express').Router();
const { PrismaClient: PkgPrisma } = require('@prisma/client');
const pkgPrisma = new PkgPrisma();

// List all active packages
pkgRouter.get('/', async (req, res) => {
  try {
    const packages = await pkgPrisma.package.findMany({
      where: { isActive: true },
      orderBy: { priceKES: 'asc' },
    });
    return res.json({ success: true, packages });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = pkgRouter;


// ─────────────────────────────────────────────────────────────────────────────
// src/routes/scans.js — log scan events for analytics
const scanRouter = require('express').Router();
const { PrismaClient: ScanPrisma } = require('@prisma/client');
const scanPrisma = new ScanPrisma();

scanRouter.post('/log', async (req, res) => {
  try {
    const { deviceId, scanType, result, alertCount, countryCode } = req.body;
    await scanPrisma.scanEvent.create({
      data: { deviceId, scanType, result, alertCount: alertCount || 0, countryCode },
    });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = scanRouter;


// ─────────────────────────────────────────────────────────────────────────────
// src/routes/admin.js — protected admin endpoints
const adminRouter  = require('express').Router();
const { PrismaClient: AdminPrisma } = require('@prisma/client');
const adminPrisma  = new AdminPrisma();
const adminAffSvc  = require('../services/affiliate');

// Simple API key auth middleware for admin routes
const adminAuth = (req, res, next) => {
  const key = req.headers['x-admin-key'];
  if (!key || key !== process.env.API_SECRET) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  next();
};

adminRouter.use(adminAuth);

// Dashboard stats
adminRouter.get('/stats', async (req, res) => {
  try {
    const [
      totalRevenue,
      totalTransactions,
      activeCredits,
      pendingAffiliates,
      totalScanEvents,
    ] = await Promise.all([
      adminPrisma.transaction.aggregate({
        where: { paymentStatus: 'success' },
        _sum: { amountKES: true },
      }),
      adminPrisma.transaction.count({ where: { paymentStatus: 'success' } }),
      adminPrisma.credit.count({ where: { isActive: true } }),
      adminPrisma.affiliate.count({ where: { status: 'pending' } }),
      adminPrisma.scanEvent.count(),
    ]);

    return res.json({
      success: true,
      totalRevenueKES:      totalRevenue._sum.amountKES || 0,
      totalTransactions,
      activeCredits,
      pendingAffiliates,
      totalScanEvents,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// List pending affiliate applications
adminRouter.get('/affiliates/pending', async (req, res) => {
  try {
    const affiliates = await adminPrisma.affiliate.findMany({
      where:   { status: 'pending' },
      orderBy: { createdAt: 'asc' },
    });
    return res.json({ success: true, affiliates });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Approve affiliate
adminRouter.post('/affiliates/:id/approve', async (req, res) => {
  try {
    const affiliate = await adminAffSvc.approveAffiliate(req.params.id);
    return res.json({ success: true, affiliate });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Recent transactions
adminRouter.get('/transactions', async (req, res) => {
  try {
    const page    = parseInt(req.query.page || 1);
    const perPage = parseInt(req.query.perPage || 20);
    const txns = await adminPrisma.transaction.findMany({
      skip:    (page - 1) * perPage,
      take:    perPage,
      orderBy: { createdAt: 'desc' },
      include: { package: true },
    });
    return res.json({ success: true, transactions: txns, page, perPage });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = adminRouter;
