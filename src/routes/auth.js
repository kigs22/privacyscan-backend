// src/routes/auth.js
const router   = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const prisma   = new PrismaClient();
const crypto   = require('crypto');
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);
const logger   = require('../utils/logger');

const OTP_EXPIRY_MINUTES = 10;

// ── Email transporter (Gmail) ──────────────────────────────────────────────
// Using Resend for email

// ── Generate 6-digit OTP ───────────────────────────────────────────────────
const generateOTP = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

// ── Send OTP Email ─────────────────────────────────────────────────────────
const sendOTPEmail = async (email, otp) => {
  await resend.emails.send({
    from: 'PrivacyScan <noreply@support.pesagate.com>',
    to:      email,
    subject: `Your PrivacyScan verification code: ${otp}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#080D1A;color:#F5F0E8;border-radius:16px;padding:40px;">
        <h1 style="color:#00D4AA;font-size:24px;margin-bottom:8px;">PrivacyScan</h1>
        <p style="color:#8896A4;margin-bottom:32px;">Your verification code</p>
        <div style="background:#111827;border:2px solid #00D4AA;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
          <span style="font-size:42px;font-weight:700;letter-spacing:12px;color:#00D4AA;">${otp}</span>
        </div>
        <p style="color:#8896A4;font-size:14px;">This code expires in ${OTP_EXPIRY_MINUTES} minutes.</p>
        <p style="color:#8896A4;font-size:14px;">If you didn't request this, you can safely ignore this email.</p>
        <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:24px 0;"/>
        <p style="color:#4A5568;font-size:12px;">PrivacyScan by Pesagate Ltd · pesagate.com</p>
      </div>
    `,
    text: `Your PrivacyScan verification code is: ${otp}\n\nThis code expires in ${OTP_EXPIRY_MINUTES} minutes.`,
  });
};

// ── REQUEST OTP ────────────────────────────────────────────────────────────
router.post('/request-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, message: 'Valid email required' });
    }

    const otp       = generateOTP();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    await prisma.user.upsert({
      where:  { email: email.toLowerCase() },
      update: { otp, otpExpiresAt: expiresAt, otpAttempts: 0 },
      create: { email: email.toLowerCase(), otp, otpExpiresAt: expiresAt, otpAttempts: 0 },
    });

    await sendOTPEmail(email, otp);

    logger.info('OTP sent', { email });
    return res.json({ success: true, message: `Verification code sent to ${email}` });

  } catch (err) {
    logger.error('Request OTP error', { err: err.message });
    return res.status(500).json({ success: false, message: 'Failed to send code. Please try again.' });
  }
});

// ── VERIFY OTP ─────────────────────────────────────────────────────────────
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp, deviceId } = req.body;

    if (!email || !otp || !deviceId) {
      return res.status(400).json({ success: false, message: 'Email, OTP and deviceId required' });
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

    if (!user) {
      return res.status(404).json({ success: false, message: 'Email not found. Please request a new code.' });
    }

    if (user.otpAttempts >= 5) {
      return res.status(429).json({ success: false, message: 'Too many attempts. Please request a new code.' });
    }

    if (new Date() > user.otpExpiresAt) {
      return res.status(400).json({ success: false, message: 'Code expired. Please request a new one.' });
    }

    if (user.otp !== otp) {
      await prisma.user.update({
        where: { email: email.toLowerCase() },
        data:  { otpAttempts: { increment: 1 } },
      });
      const remaining = 4 - user.otpAttempts;
      return res.status(400).json({ success: false, message: `Incorrect code. ${remaining} attempts remaining.` });
    }

    const token = crypto.randomBytes(32).toString('hex');

    await prisma.user.update({
      where: { email: email.toLowerCase() },
      data: {
        otp: null, otpExpiresAt: null, otpAttempts: 0,
        isVerified: true, sessionToken: token,
        deviceId, lastLoginAt: new Date(),
      },
    });

    // Transfer credits from device to user email
    await prisma.credit.updateMany({
      where: { deviceId },
      data:  { userEmail: email.toLowerCase() },
    });

    logger.info('OTP verified', { email });
    return res.json({ success: true, token, email: email.toLowerCase() });

  } catch (err) {
    logger.error('Verify OTP error', { err: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET PROFILE ────────────────────────────────────────────────────────────
router.get('/profile', async (req, res) => {
  try {
    const token = req.headers['x-auth-token'];
    if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const user = await prisma.user.findFirst({
      where: { sessionToken: token },
      select: { email: true, deviceId: true, isVerified: true, createdAt: true },
    });

    if (!user) return res.status(401).json({ success: false, message: 'Invalid session' });
    return res.json({ success: true, user });

  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
