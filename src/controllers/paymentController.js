// src/controllers/paymentController.js
// Paystack-only — handles card, M-Pesa, Airtel Money in one flow
const { v4: uuidv4 }   = require('uuid');
const { PrismaClient } = require('@prisma/client');
const prisma           = new PrismaClient();
const paystackSvc      = require('../services/paystack');
const creditsSvc       = require('../services/credits');
const affiliateSvc     = require('../services/affiliate');
const { toPaystackAmount } = require('../utils/currency');
const logger           = require('../utils/logger');

// ── INITIATE PAYMENT ───────────────────────────────────────────────────────────
exports.initiatePayment = async (req, res) => {
  try {
    const { email, packageId, currency, deviceId, affiliateCode, metadata } = req.body;

    // Validate package
    const pkg = await prisma.package.findUnique({ where: { id: packageId } });
    if (!pkg || !pkg.isActive) {
      return res.status(400).json({ success: false, message: 'Invalid or unavailable package' });
    }

    // Validate affiliate code (non-blocking — bad code just gets ignored)
    const affiliate = await affiliateSvc.validateCode(affiliateCode);

    // Unique transaction reference
    const reference = `PS-${uuidv4().split('-')[0].toUpperCase()}-${Date.now()}`;

    // Convert KES to target currency in Paystack minor units
    const resolvedCurrency = currency || 'KES';
    const amountKobo       = toPaystackAmount(pkg.priceKES, resolvedCurrency);

    // Initialise Paystack — they show M-Pesa/Airtel/card based on country
    const { authorizationUrl } = await paystackSvc.initializeTransaction({
      email,
      amountKobo,
      currency: resolvedCurrency,
      reference,
      metadata: {
        packageId,
        packageName:   pkg.name,
        packageSlug:   pkg.slug,
        scans:         pkg.scans,
        validityHours: pkg.validityHours,
        deviceId,
        affiliateCode: affiliate ? affiliateCode.toUpperCase() : null,
        custom_fields: [
          { display_name: 'Package',   variable_name: 'package',    value: pkg.name },
          { display_name: 'Device ID', variable_name: 'device_id',  value: deviceId },
        ],
        ...metadata,
      },
    });

    // Record pending transaction
    await prisma.transaction.create({
      data: {
        reference,
        deviceId:      deviceId || 'unknown',
        email,
        amountKES:     pkg.priceKES,
        currency:      resolvedCurrency,
        amountLocal:   amountKobo / 100,
        packageId:     pkg.id,
        affiliateCode: affiliate ? affiliateCode.toUpperCase() : null,
        paymentMethod: 'paystack',
        paymentStatus: 'pending',
        paystackRef:   reference,
      },
    });

    logger.info('Payment initiated', { reference, package: pkg.slug, email, currency: resolvedCurrency });

    return res.json({ success: true, authorizationUrl, reference });

  } catch (err) {
    logger.error('Initiate payment error', { err: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── VERIFY PAYMENT ─────────────────────────────────────────────────────────────
exports.verifyPayment = async (req, res) => {
  try {
    const { reference } = req.params;

    const txn = await prisma.transaction.findUnique({
      where:   { reference },
      include: { package: true },
    });

    if (!txn) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    // Already verified — return cached result
    if (txn.paymentStatus === 'success') {
      return res.json({
        success: true,
        status:  'success',
        channel: txn.paymentMethod,
        package: {
          id:            txn.package.id,
          name:          txn.package.name,
          scans:         txn.package.scans,
          validityHours: txn.package.validityHours,
        },
      });
    }

    // Verify with Paystack
    const result = await paystackSvc.verifyTransaction(reference);

    if (result.status !== 'success') {
      await prisma.transaction.update({
        where: { reference },
        data:  { paymentStatus: result.status },
      });
      return res.json({
        success: false,
        status:  result.status,
        message: result.gatewayResponse || 'Payment not confirmed',
      });
    }

    // Mark transaction successful
    await prisma.transaction.update({
      where: { reference },
      data: {
        paymentStatus: 'success',
        paymentMethod: result.channel || 'paystack',
      },
    });

    // Issue scan credits to device
    await creditsSvc.issueCredits({
      deviceId:      txn.deviceId,
      packageId:     txn.packageId,
      transactionId: txn.id,
    });

    // Credit affiliate commission (60%)
    await affiliateSvc.creditCommission({
      affiliateCode:  txn.affiliateCode,
      transactionId:  txn.id,
      amountKES:      txn.amountKES,
    });

    logger.info('Payment verified', { reference, channel: result.channel, package: txn.package.slug });

    return res.json({
      success: true,
      status:  'success',
      channel: result.channel,
      package: {
        id:            txn.package.id,
        name:          txn.package.name,
        scans:         txn.package.scans,
        validityHours: txn.package.validityHours,
      },
    });

  } catch (err) {
    logger.error('Verify payment error', { err: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── PAYSTACK WEBHOOK ───────────────────────────────────────────────────────────
// Paystack calls this automatically on payment events
// This is the most reliable confirmation method
exports.paystackWebhook = async (req, res) => {
  try {
    const signature = req.headers['x-paystack-signature'];

    if (!paystackSvc.validateWebhookSignature(req.rawBody, signature)) {
      logger.warn('Invalid Paystack webhook signature — rejected');
      return res.status(400).json({ message: 'Invalid signature' });
    }

    const event = req.body;
    logger.info('Paystack webhook received', { event: event.event });

    // ── charge.success ─────────────────────────────────────────────────────
    if (event.event === 'charge.success') {
      const { reference, channel } = event.data;

      const txn = await prisma.transaction.findUnique({
        where:   { reference },
        include: { package: true },
      });

      if (txn && txn.paymentStatus !== 'success') {
        await prisma.transaction.update({
          where: { reference },
          data: {
            paymentStatus:  'success',
            paymentMethod:  channel || 'paystack',
            rawWebhookData: JSON.stringify(event.data),
          },
        });

        await creditsSvc.issueCredits({
          deviceId:      txn.deviceId,
          packageId:     txn.packageId,
          transactionId: txn.id,
        });

        await affiliateSvc.creditCommission({
          affiliateCode:  txn.affiliateCode,
          transactionId:  txn.id,
          amountKES:      txn.amountKES,
        });

        logger.info('Webhook: credits issued', { reference, channel, package: txn.package.slug });
      }
    }

    // ── charge.dispute.create ──────────────────────────────────────────────
    if (event.event === 'charge.dispute.create') {
      logger.warn('Dispute raised', {
        reference: event.data.transaction?.reference,
        amount:    event.data.amount,
      });
      // TODO: flag transaction for review, consider suspending credits
    }

    // ── refund.processed ──────────────────────────────────────────────────
    if (event.event === 'refund.processed') {
      const reference = event.data.transaction?.reference;
      if (reference) {
        await prisma.transaction.update({
          where: { reference },
          data:  { paymentStatus: 'refunded' },
        });
        // Deactivate credits for refunded transaction
        await prisma.credit.updateMany({
          where: { transaction: { reference } },
          data:  { isActive: false },
        });
        logger.info('Refund processed — credits deactivated', { reference });
      }
    }

    // Always respond 200 to Paystack
    return res.sendStatus(200);

  } catch (err) {
    logger.error('Webhook processing error', { err: err.message });
    return res.sendStatus(200); // Still 200 — Paystack retries on non-200
  }
};

// ── PAYSTACK CALLBACK (browser redirect) ──────────────────────────────────────
// After user completes payment in browser, Paystack redirects here
// The app polls /verify/:reference separately — this just acknowledges
exports.paystackCallback = async (req, res) => {
  const { reference, trxref } = req.query;
  const ref = reference || trxref;
  logger.info('Paystack browser callback', { reference: ref });
  // Redirect to a friendly page or deep link back to app
  res.redirect(`https://www.pesagate.com/privacyscanner?payment=complete&ref=${ref}`);
};
