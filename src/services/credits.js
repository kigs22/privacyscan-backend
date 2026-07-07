// src/services/credits.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const logger = require('../utils/logger');

/**
 * Issue credits to a device after successful payment
 */
const issueCredits = async ({ deviceId, packageId, transactionId }) => {
  const pkg = await prisma.package.findUnique({ where: { id: packageId } });
  if (!pkg) throw new Error(`Package ${packageId} not found`);

  const validityHours = pkg.validityHours;
  const expiresAt = validityHours > 0
    ? new Date(Date.now() + validityHours * 60 * 60 * 1000)
    : null; // null = no expiry (would only apply if we ever add a lifetime plan)

  // Deactivate any existing credits for this device
  await prisma.credit.updateMany({
    where:  { deviceId, isActive: true },
    data:   { isActive: false },
  });

  const credit = await prisma.credit.create({
    data: {
      deviceId,
      packageId,
      transactionId,
      scansTotal: pkg.scans,  // -1 = unlimited
      scansUsed:  0,
      expiresAt,
      isActive:   true,
    },
    include: { package: true },
  });

  logger.info('Credits issued', {
    deviceId,
    packageSlug: pkg.slug,
    scansTotal:  credit.scansTotal,
    expiresAt:   credit.expiresAt,
  });

  return credit;
};

/**
 * Get active credits for a device
 */
const getCredits = async (deviceId) => {
  const credit = await prisma.credit.findFirst({
    where: {
      deviceId,
      isActive: true,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    include: { package: true },
    orderBy: { createdAt: 'desc' },
  });

  if (!credit) {
    return { hasCredits: false, count: 0, expiresAt: null, packageName: null };
  }

  const count = credit.scansTotal === -1
    ? -1  // unlimited
    : credit.scansTotal - credit.scansUsed;

  return {
    hasCredits:  count === -1 || count > 0,
    count,
    scansUsed:   credit.scansUsed,
    scansTotal:  credit.scansTotal,
    expiresAt:   credit.expiresAt,
    packageName: credit.package.name,
    packageSlug: credit.package.slug,
    creditId:    credit.id,
  };
};

/**
 * Consume one credit from a device
 * Returns { success, remaining }
 */
const consumeCredit = async (deviceId) => {
  const credit = await prisma.credit.findFirst({
    where: {
      deviceId,
      isActive: true,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
  });

  if (!credit) {
    return { success: false, reason: 'No active credits' };
  }

  // Unlimited plan — don't decrement
  if (credit.scansTotal === -1) {
    return { success: true, remaining: -1 };
  }

  if (credit.scansUsed >= credit.scansTotal) {
    return { success: false, reason: 'Credits exhausted' };
  }

  const updated = await prisma.credit.update({
    where: { id: credit.id },
    data:  { scansUsed: { increment: 1 } },
  });

  const remaining = updated.scansTotal - updated.scansUsed;

  // Auto-deactivate if exhausted
  if (remaining <= 0) {
    await prisma.credit.update({
      where: { id: credit.id },
      data:  { isActive: false },
    });
  }

  return { success: true, remaining };
};

/**
 * Expire stale credits (run via cron)
 */
const expireStaleCredits = async () => {
  const result = await prisma.credit.updateMany({
    where: {
      isActive:  true,
      expiresAt: { lt: new Date() },
    },
    data: { isActive: false },
  });
  logger.info(`Expired ${result.count} stale credit records`);
  return result.count;
};

module.exports = { issueCredits, getCredits, consumeCredit, expireStaleCredits };
