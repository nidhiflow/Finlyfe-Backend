import express from 'express';
import { query } from '../db/index.js';

const router = express.Router();

const mockUserMiddleware = (req, res, next) => {
  req.user = req.user || { id: '1' };
  next();
};

router.use(mockUserMiddleware);

// Get budgets
router.get('/', async (req, res) => {
  const { month } = req.query; // format: 'YYYY-MM'
  try {
    let sql = 'SELECT * FROM budgets WHERE user_id = $1';
    let params = [req.user.id];
    if (month) {
      sql += ' AND month = $2';
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
        INSERT INTO budgets (id, user_id, category_id, amount, month)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id, category_id, month) DO UPDATE SET amount = EXCLUDED.amount
      `, [id, req.user.id, category_id, amount, month]);
    }
    res.json({ message: 'Budgets updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
