// src/utils/currency.js

const RATES = {
  KES: 1,
  USD: 0.0077,
  GBP: 0.0061,
  AUD: 0.012,
  NGN: 12.5,
  ZAR: 0.14,
  INR: 0.64,
  CAD: 0.011,
  GHS: 0.093,
  TZS: 19.8,
  UGX: 28.5,
};

/**
 * Convert KES amount to target currency
 * @param {number} amountKES
 * @param {string} toCurrency - ISO 4217 code
 * @returns {number}
 */
const convertFromKES = (amountKES, toCurrency = 'KES') => {
  const rate = RATES[toCurrency.toUpperCase()] || RATES.USD;
  const converted = amountKES * rate;
  // Round to 2 decimal places for most currencies
  return Math.round(converted * 100) / 100;
};

/**
 * Paystack amount in minor units (kobo/pesewas/cents)
 * Paystack always expects amounts * 100
 */
const toPaystackAmount = (amountKES, currency = 'KES') => {
  const converted = convertFromKES(amountKES, currency);
  return Math.round(converted * 100);
};

/**
 * M-Pesa only accepts KES integers
 */
const toMpesaAmount = (amountKES) => Math.ceil(amountKES);

module.exports = { convertFromKES, toPaystackAmount, toMpesaAmount, RATES };
