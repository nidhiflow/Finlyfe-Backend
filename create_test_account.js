// Creates (or resets) the account handed to the Razorpay review team.
//
//   node create_test_account.js
//
// Safe to re-run: if the account already exists it is reset back to a clean
// Free-tier state with the same password, so the upgrade/payment flow can be
// walked through again from the top.

import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { query } from './db/index.js';
import { seedDefaultsForUser } from './db/seed.js';

const TEST_EMAIL = 'razorpay.test@finly.app';
const TEST_PASSWORD = 'Razorpay@2026';
const TEST_NAME = 'Razorpay Reviewer';
const TEST_PHONE = '9999999999';

async function run() {
  const hashed = bcrypt.hashSync(TEST_PASSWORD, 10);

  const { rows: existing } = await query('SELECT id FROM users WHERE email = $1', [TEST_EMAIL]);

  if (existing.length > 0) {
    // Reset it: known password, Free tier, no leftover subscription window.
    await query(
      `UPDATE users
         SET password = $1, name = $2, phone = $3, email_verified = true,
             subscription_tier = 'Free', subscription_expires_at = NULL
       WHERE email = $4`,
      [hashed, TEST_NAME, TEST_PHONE, TEST_EMAIL]
    );
    // Clear device fingerprints so no stale "new device" state trips anything up.
    await query('DELETE FROM login_devices WHERE user_id = $1', [existing[0].id]);
    console.log(`↻ Reset existing test account (${existing[0].id})`);
  } else {
    const userId = uuidv4();
    await query(
      `INSERT INTO users (id, name, email, password, phone, email_verified, subscription_tier)
       VALUES ($1, $2, $3, $4, $5, true, 'Free')`,
      [userId, TEST_NAME, TEST_EMAIL, hashed, TEST_PHONE]
    );
    await seedDefaultsForUser(userId);
    console.log(`✓ Created test account (${userId})`);
  }

  console.log('');
  console.log('  Email    :', TEST_EMAIL);
  console.log('  Password :', TEST_PASSWORD);
  console.log('  Tier     : Free (so the Pro upgrade / payment flow is available)');
  console.log('');
  process.exit(0);
}

run().catch((err) => {
  console.error('Failed to create test account:', err);
  process.exit(1);
});
