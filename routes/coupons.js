import express from 'express';
import { query } from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);

// Coupon catalogue — code -> { tier, months }
const COUPONS = {
  MUKUNFREE: { tier: 'Premium', months: 6 },
  PG1011: { tier: 'Premium', months: 6 },
};

// POST /api/coupons/redeem — apply a promo code to the current user's subscription
router.post('/redeem', async (req, res) => {
  const { code } = req.body;
  const normalizedCode = (code || '').trim().toUpperCase();
  const coupon = COUPONS[normalizedCode];

  if (!coupon) {
    return res.status(400).json({ error: 'Invalid coupon code' });
  }

  try {
    const { rows: existing } = await query(
      'SELECT id FROM coupon_redemptions WHERE user_id = $1 AND code = $2',
      [req.userId, normalizedCode]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: 'You have already redeemed this coupon' });
    }

    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + coupon.months);

    const { rows: updated } = await query(
      `UPDATE users SET subscription_tier = $1, subscription_expires_at = $2
       WHERE id = $3 RETURNING id, name, email, phone, photo, subscription_tier, subscription_expires_at, email_verified, created_at`,
      [coupon.tier, expiresAt, req.userId]
    );

    await query(
      'INSERT INTO coupon_redemptions (id, user_id, code, redeemed_at) VALUES ($1, $2, $3, NOW())',
      [Date.now().toString(), req.userId, normalizedCode]
    );

    res.json({
      message: `Coupon applied! You now have ${coupon.tier} free until ${expiresAt.toDateString()}.`,
      user: updated[0],
    });
  } catch (err) {
    console.error('Coupon redemption error:', err);
    res.status(500).json({ error: 'Failed to redeem coupon' });
  }
});

export default router;
