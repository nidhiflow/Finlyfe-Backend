import express from 'express';
import { query } from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);

// Get budgets
router.get('/', async (req, res) => {
  const { month } = req.query; // format: 'YYYY-MM'
  try {
    let sql = 'SELECT * FROM budgets WHERE user_id = $1';
    let params = [req.userId];
    if (month) {
      sql += ' AND period = $2';
      params.push(month);
    }
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save budgets (batch update or create)
router.post('/', async (req, res) => {
  const data = req.body; 
  try {
    const budgets = Array.isArray(data) ? data : [data];
    for (const b of budgets) {
      const { category_id, amount, month } = b;
      const id = Date.now().toString() + Math.random().toString(36).substr(2, 5);
      await query(`
        INSERT INTO budgets (id, user_id, category_id, amount, period)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id, category_id, period) DO UPDATE SET amount = EXCLUDED.amount
      `, [id, req.userId, category_id, amount, month]);
    }
    res.json({ message: 'Budgets updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
