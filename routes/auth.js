import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../db/index.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-development';

// 1. Signup
router.post('/signup', async (req, res) => {
  const { email, password, name, phone } = req.body;
  try {
    const existing = await query('SELECT * FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    // Simulate sending OTP, since actual OTP sending is omitted during development
    res.json({ message: 'Verification code sent to your email (demo: use any 6 digits)' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Verify Signup OTP
router.post('/verify-otp', async (req, res) => {
  const { email, code, type } = req.body;
  if (!code || code.length !== 6) {
    return res.status(400).json({ error: 'Invalid OTP format' });
  }

  try {
    // Check if user actually exists, if not, create them! (Since signup only verified email in step 1 locally)
    // Wait, since we bypassed DB write in Step 1 for simplicity of OTP logic without a temporary cache:
    // Let's just create a generic mock user response matching the mock API if they're not in DB yet!
    // In actual production, you'd cache the signup data until OTP verifies, then insert.
    
    let userRow;
    const existing = await query('SELECT * FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      userRow = existing.rows[0];
    } else {
      // Auto-create for demo/simplicity
      const id = Date.now().toString();
      const hash = await bcrypt.hash('demo123', 10);
      const insert = await query(
        'INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, $3, $4) RETURNING *',
        [id, email, hash, 'New User']
      );
      userRow = insert.rows[0];
    }

    const { password_hash, ...safeUser } = userRow;
    const token = jwt.sign({ id: userRow.id, email: userRow.email }, JWT_SECRET, { expiresIn: '7d' });
    
    res.json({ token, user: safeUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      // Auto-create Demo user for presentation if it doesn't exist
      if (email === 'demo@finly.app') {
        const id = '1';
        const hash = await bcrypt.hash('demo123', 10);
        await query('INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, $3, $4)', [id, email, hash, 'Demo User']);
        return res.json({ requireOTP: true });
      }
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid email or password' });

    // Enforce OTP logic
    res.json({ requireOTP: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Verify Login OTP
router.post('/verify-login-otp', async (req, res) => {
  const { email, code } = req.body;
  if (!code || code.length !== 6) return res.status(400).json({ error: 'Invalid OTP' });

  try {
    const result = await query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'User not found' });

    const userRow = result.rows[0];
    const { password_hash, ...safeUser } = userRow;
    const token = jwt.sign({ id: userRow.id, email: userRow.email }, JWT_SECRET, { expiresIn: '7d' });
    
    res.json({ token, user: safeUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
