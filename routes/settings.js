import express from 'express';
import { query } from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);

router.get('/', async (req, res) => {
  try {
    const result = await query('SELECT * FROM settings WHERE user_id = $1', [req.user.id]);
    // Format to a JSON object of key-values
    const settingsMap = {};
    result.rows.forEach(r => {
      try {
        settingsMap[r.key] = JSON.parse(r.value);
      } catch {
        settingsMap[r.key] = r.value;
      }
    });
    res.json(settingsMap);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const data = req.body;
  try {
    for (const [key, value] of Object.entries(data)) {
      const valStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
      await query(`
        INSERT INTO settings (user_id, key, value) 
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value
      `, [req.user.id, key, valStr]);
    }
    res.json({ message: "Settings updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
