// src/services/affiliate.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const logger = require('../utils/logger');

const COMMISSION_RATE = parseFloat(process.env.AFFILIATE_COMMISSION_RATE || '0.60');

/**
 * Validate affiliate code and return affiliate record
 */
const validateCode = async (code) => {
  if (!code) return null;
  const affiliate = await prisma.affiliate.findUnique({
    where: { code: code.toUpperCase() },
  });
  if (!affiliate || affiliate.status !== 'approved') return null;
  return affiliate;
};

/**
 * Credit commission to an affiliate after successful sale
 */
const creditCommission = async ({ affiliateCode, transactionId, amountKES }) => {
  if (!affiliateCode) return null;

  const affiliate = await validateCode(affiliateCode);
  if (!affiliate) {
    logger.warn('Commission credit skipped — invalid/unapproved code', { affiliateCode });
    return null;
  }

  const commissionAmount = Math.round(amountKES * affiliate.commissionRate);

  // Update affiliate balance
  await prisma.affiliate.update({
    where: { code: affiliateCode.toUpperCase() },
    data: {
      totalEarned:    { increment: commissionAmount },
      pendingBalance: { increment: commissionAmount },
    },
  });

  // Mark transaction as commission paid
  await prisma.transaction.update({
    where: { id: transactionId },
    data: {
      commissionPaid:   true,
      commissionAmount,
    },
  });

  logger.info('Commission credited', {
    affiliateCode,
    transactionId,
    amountKES,
    commissionAmount,
  });

  return { affiliateCode, commissionAmount, commissionRate: affiliate.commissionRate };
};

/**
 * Get affiliate stats
 */
const getStats = async (code) => {
  const affiliate = await prisma.affiliate.findUnique({
    where: { code: code.toUpperCase() },
    include: {
      transactions: {
        where: { paymentStatus: 'success' },
        select: {
          amountKES: true,
          commissionAmount: true,
          createdAt: true,
          package: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
      payouts: { orderBy: { createdAt: 'desc' }, take: 10 },
    },
  });

  if (!affiliate) return null;

  const salesCount = affiliate.transactions.length;
  const totalCommissionKES = affiliate.totalEarned / 100;
  const pendingKES = affiliate.pendingBalance / 100;
  const paidKES = affiliate.totalPaid / 100;

  return {
    code:            affiliate.code,
    name:            affiliate.name,
    status:          affiliate.status,
    commissionRate:  affiliate.commissionRate,
    totalEarnedKES:  totalCommissionKES,
    pendingKES,
    paidKES,
    salesCount,
    recentSales:     affiliate.transactions,
    recentPayouts:   affiliate.payouts,
  };
};

/**
 * Apply for affiliate program
 */
const createApplication = async ({
  name, email, phone, country,
  payoutMethod, payoutDetails,
  promoChannel, socialHandle, notes,
}) => {
  // Generate unique code: first 3 letters of name + 4 random digits
  const base = name.replace(/\s+/g, '').toUpperCase().slice(0, 4);
  const rand = Math.floor(1000 + Math.random() * 9000);
  const code = `${base}${rand}`;

  const affiliate = await prisma.affiliate.create({
    data: {
      code,
      name,
      email,
      phone,
      country,
      payoutMethod,
      payoutDetails: JSON.stringify(payoutDetails),
      promoChannel,
      socialHandle,
      notes,
      status: 'pending',
    },
  });

  return affiliate;
};

/**
 * Approve an affiliate application (admin)
 */
const approveAffiliate = async (id) => {
  return prisma.affiliate.update({
    where: { id },
    data: {
      status:     'approved',
      approvedAt: new Date(),
    },
  });
};

/**
 * Record a payout to an affiliate
 */
const recordPayout = async ({ affiliateId, amountKES, method, reference, notes }) => {
  const amountCents = Math.round(amountKES * 100);

  const [payout] = await prisma.$transaction([
    prisma.affilaitePayout.create({
      data: {
        affiliateId,
        amountKES: amountCents,
        method,
        reference,
        status: 'paid',
        notes,
        paidAt: new Date(),
      },
    }),
    prisma.affiliate.update({
      where: { id: affiliateId },
      data: {
        totalPaid:      { increment: amountCents },
        pendingBalance: { decrement: amountCents },
      },
    }),
  ]);

  return payout;
};

module.exports = {
  validateCode,
  creditCommission,
  getStats,
  createApplication,
  approveAffiliate,
  recordPayout,
};
