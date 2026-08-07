import express from 'express';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';
import { getPlanAmount } from '../services/planPricing.js';

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Marks a payments row paid and grants the plan it was created for. Idempotent so it's
// safe to call from both the webhook and the qr-status polling fallback for the same event.
async function markPaymentPaid(paymentRow, razorpayPaymentId) {
  if (paymentRow.status === 'paid') return;
  await query(
    `UPDATE payments SET status = 'paid', razorpay_payment_id = $1, updated_at = NOW() WHERE id = $2`,
    [razorpayPaymentId || null, paymentRow.id]
  );
  await query(
    `UPDATE users SET subscription_tier = $1 WHERE id = $2`,
    [paymentRow.plan, paymentRow.user_id]
  );
}

// POST /api/payments/webhook — Razorpay server-to-server callback.
// Registered before router.use(authenticateToken) below: Razorpay has no user JWT,
// it authenticates itself via the X-Razorpay-Signature header instead.
router.post('/webhook', async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!secret) {
    console.error('RAZORPAY_WEBHOOK_SECRET is not set; rejecting webhook');
    return res.status(500).json({ error: 'Webhook not configured' });
  }
  if (!signature || !req.rawBody) {
    return res.status(400).json({ error: 'Missing signature or body' });
  }

  const expectedSignature = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  const isValid =
    expectedSignature.length === signature.length &&
    crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature));

  if (!isValid) {
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }

  try {
    const { event, payload } = req.body;

    if (event === 'qr_code.credited') {
      const qrCodeId = payload?.qr_code?.entity?.id;
      const paymentId = payload?.payment?.entity?.id;

      if (qrCodeId) {
        const { rows } = await query('SELECT * FROM payments WHERE qr_code_id = $1', [qrCodeId]);
        if (rows[0]) {
          await markPaymentPaid(rows[0], paymentId);
        } else {
          console.warn(`Webhook: no payments row found for qr_code_id ${qrCodeId}`);
        }
      }
    }

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Webhook handling error:', err);
    // Still 200: the signature was valid, this is our bug to fix, not Razorpay's to retry.
    res.status(200).json({ status: 'error_logged' });
  }
});

router.use(authenticateToken);

// POST /api/payments/create-order
router.post('/create-order', async (req, res) => {
  const { plan, billingCycle, receipt } = req.body;
  const pricing = getPlanAmount(plan, billingCycle);

  if (!pricing) {
    return res.status(400).json({ error: 'Unknown plan or billing cycle' });
  }

  try {
    const order = await razorpay.orders.create({
      amount: pricing.amount,
      currency: 'INR',
      receipt: receipt || `rcpt_${req.userId}_${Date.now()}`,
    });

    await query(
      `INSERT INTO payments (id, order_id, user_id, plan, billing_cycle, amount, status, method)
       VALUES ($1, $2, $3, $4, $5, $6, 'created', 'checkout')`,
      [uuidv4(), order.id, req.userId, plan, pricing.billingCycle, pricing.amount]
    );

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
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

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
    // The plan is read back from the order *we* created, never from the request body —
    // otherwise a client could pay for a cheap order and ask to be granted an expensive plan.
    const { rows } = await query(
      'SELECT * FROM payments WHERE order_id = $1 AND user_id = $2',
      [razorpay_order_id, req.userId]
    );
    const paymentRow = rows[0];
    if (!paymentRow) {
      return res.status(404).json({ success: false, error: 'No matching order found for this user' });
    }

    await markPaymentPaid(paymentRow, razorpay_payment_id);

    const { rows: userRows } = await query(
      'SELECT id, name, email, phone, photo, subscription_tier, email_verified, created_at FROM users WHERE id = $1',
      [req.userId]
    );

    res.json({ success: true, message: 'Payment verified successfully', user: userRows[0] });
  } catch (err) {
    console.error('Verify payment error:', err);
    res.status(500).json({ success: false, error: 'Payment verified but failed to update subscription' });
  }
});

// POST /api/payments/create-qr — single-use dynamic UPI QR, 10-minute expiry
router.post('/create-qr', async (req, res) => {
  const { plan, billingCycle } = req.body;
  const pricing = getPlanAmount(plan, billingCycle);

  if (!pricing) {
    return res.status(400).json({ error: 'Unknown plan or billing cycle' });
  }

  try {
    const closeBy = Math.floor(Date.now() / 1000) + 10 * 60;
    const qr = await razorpay.qrCode.create({
      type: 'upi_qr',
      name: 'Finly',
      usage: 'single_use',
      fixed_amount: true,
      payment_amount: pricing.amount,
      description: `Finly ${plan} (${pricing.billingCycle})`,
      close_by: closeBy,
      notes: { user_id: req.userId, plan, billing_cycle: pricing.billingCycle },
    });

    await query(
      `INSERT INTO payments (id, order_id, user_id, plan, billing_cycle, amount, status, method, qr_code_id)
       VALUES ($1, NULL, $2, $3, $4, $5, 'pending', 'qr', $6)`,
      [uuidv4(), req.userId, plan, pricing.billingCycle, pricing.amount, qr.id]
    );

    res.json({
      qr_code_id: qr.id,
      image_url: qr.image_url,
      amount: pricing.amount,
      currency: 'INR',
      close_by: qr.close_by,
    });
  } catch (err) {
    console.error('Create QR error:', err);
    if (err.statusCode === 401) {
      return res.status(401).json({ error: 'Razorpay authentication failed' });
    }
    res.status(500).json({ error: 'Failed to create QR code' });
  }
});

// GET /api/payments/qr-status/:qr_code_id — polling fallback for clients that can't
// wait on the webhook; scoped to the caller's own payment row.
router.get('/qr-status/:qr_code_id', async (req, res) => {
  const { qr_code_id } = req.params;

  try {
    const { rows } = await query(
      'SELECT * FROM payments WHERE qr_code_id = $1 AND user_id = $2',
      [qr_code_id, req.userId]
    );
    const paymentRow = rows[0];
    if (!paymentRow) {
      return res.status(404).json({ error: 'QR payment not found' });
    }

    // Already resolved by the webhook (or a previous poll) — trust the DB, skip the API call.
    if (paymentRow.status === 'paid' || paymentRow.status === 'expired') {
      return res.json({ status: paymentRow.status });
    }

    const qr = await razorpay.qrCode.fetch(qr_code_id);

    if (qr.status === 'closed' && qr.close_reason === 'paid') {
      const payments = await razorpay.qrCode.fetchAllPayments(qr_code_id);
      const paymentId = payments?.items?.[0]?.id;
      await markPaymentPaid(paymentRow, paymentId);
      return res.json({ status: 'paid' });
    }

    if (qr.status === 'closed') {
      await query(`UPDATE payments SET status = 'expired', updated_at = NOW() WHERE id = $1`, [paymentRow.id]);
      return res.json({ status: 'expired' });
    }

    res.json({ status: 'pending' });
  } catch (err) {
    console.error('QR status error:', err);
    res.status(500).json({ error: 'Failed to fetch QR status' });
  }
});

export default router;
