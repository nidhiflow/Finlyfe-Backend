import express from 'express';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import { query } from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

router.use(authenticateToken);

// POST /api/payments/create-order
router.post('/create-order', async (req, res) => {
  const { amount, currency = 'INR', receipt } = req.body;

  if (!Number.isInteger(amount) || amount < 100) {
    return res.status(400).json({ error: 'Amount must be an integer in paise, with a minimum of 100' });
  }

  try {
    const order = await razorpay.orders.create({
      amount,
      currency,
      receipt: receipt || `rcpt_${req.userId}_${Date.now()}`,
    });
    res.json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error('Create order error:', err);
    if (err.statusCode === 401) {
      return res.status(401).json({ error: 'Razorpay authentication failed' });
    }
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// POST /api/payments/verify-payment
router.post('/verify-payment', async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ success: false, error: 'Missing required payment fields' });
  }

  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  const isValid =
    expectedSignature.length === razorpay_signature.length &&
    crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(razorpay_signature));

  if (!isValid) {
    return res.status(400).json({ success: false, error: 'Payment signature verification failed' });
  }

  try {
    let user;
    if (['Pro', 'Premium'].includes(plan)) {
      const { rows } = await query(
        'UPDATE users SET subscription_tier = $1 WHERE id = $2 RETURNING id, name, email, phone, photo, subscription_tier, email_verified, created_at',
        [plan, req.userId]
      );
      user = rows[0];
    }
    res.json({ success: true, message: 'Payment verified successfully', user });
  } catch (err) {
    console.error('Verify payment error:', err);
    res.status(500).json({ success: false, error: 'Payment verified but failed to update subscription' });
  }
});

export default router;
