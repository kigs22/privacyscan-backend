// src/services/paystack.js
// Single payment service — handles card, M-Pesa, Airtel Money via Paystack
const axios  = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');

const BASE_URL   = 'https://api.paystack.co';
const SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

const paystackAPI = axios.create({
  baseURL: BASE_URL,
  headers: {
    Authorization: `Bearer ${SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
  timeout: 15000,
});

/**
 * Initialise a Paystack transaction
 * Paystack automatically shows card, M-Pesa, Airtel Money
 * based on the customer's country
 */
const initializeTransaction = async ({
  email,
  amountKobo,
  currency,
  reference,
  metadata,
  channels,
}) => {
  const res = await paystackAPI.post('/transaction/initialize', {
    email,
    amount:   amountKobo,
    currency: currency || 'KES',
    reference,
    metadata,
    // Paystack shows relevant channels per country automatically
    // KE: M-Pesa, card | NG: card, bank, USSD | GH: Mobile Money, card
    channels: channels || ['card', 'bank', 'ussd', 'qr', 'mobile_money', 'bank_transfer'],
    callback_url: `${process.env.API_BASE_URL}/payments/callback`,
  });

  if (!res.data.status) {
    throw new Error(res.data.message || 'Paystack initialization failed');
  }

  return {
    authorizationUrl: res.data.data.authorization_url,
    accessCode:       res.data.data.access_code,
    reference:        res.data.data.reference,
  };
};

/**
 * Verify a completed transaction
 */
const verifyTransaction = async (reference) => {
  const res = await paystackAPI.get(`/transaction/verify/${reference}`);

  if (!res.data.status) {
    throw new Error(res.data.message || 'Verification failed');
  }

  const txn = res.data.data;
  return {
    status:       txn.status,        // success | failed | abandoned
    amount:       txn.amount / 100,  // back to major units
    currency:     txn.currency,
    reference:    txn.reference,
    paidAt:       txn.paid_at,
    channel:      txn.channel,       // card | mobile_money | bank_transfer etc
    customer:     txn.customer,
    metadata:     txn.metadata,
    gatewayResponse: txn.gateway_response,
  };
};

/**
 * Validate Paystack webhook HMAC-SHA512 signature
 */
const validateWebhookSignature = (rawBody, signature) => {
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest('hex');
  return hash === signature;
};

/**
 * Fetch transaction list (admin)
 */
const listTransactions = async ({ page = 1, perPage = 50, status } = {}) => {
  const params = { page, perPage };
  if (status) params.status = status;
  const res = await paystackAPI.get('/transaction', { params });
  return res.data.data;
};

/**
 * Issue refund for a transaction (admin)
 */
const refundTransaction = async (transactionId, amountKobo) => {
  const res = await paystackAPI.post('/refund', {
    transaction: transactionId,
    amount:      amountKobo,
  });
  if (!res.data.status) throw new Error(res.data.message);
  return res.data.data;
};

module.exports = {
  initializeTransaction,
  verifyTransaction,
  validateWebhookSignature,
  listTransactions,
  refundTransaction,
};
