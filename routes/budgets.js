import express from 'express';
import { query } from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);

// Get budgets with category info and spent amounts
router.get('/', async (req, res) => {
  const { month } = req.query; // format: 'YYYY-MM'
  try {
    // Get budgets with category details and calculated spend
    let sql = `
      SELECT b.id, b.category_id, b.amount, b.period,
             c.name as category_name, c.icon, c.color,
             COALESCE((
               SELECT SUM(t.amount)
               FROM transactions t
               WHERE t.category_id = b.category_id
                 AND t.user_id = b.user_id
                 AND t.type = 'expense'
                 ${month ? `AND LEFT(t.date, 7) = $2` : ''}
             ), 0) as spent
      FROM budgets b
      LEFT JOIN categories c ON b.category_id = c.id
      WHERE b.user_id = $1`;
    const params = [req.userId];
    if (month) {
      sql += ` AND (b.period = $2 OR b.period IS NULL)`;
      params.push(month);
    }
    sql += ` ORDER BY c.name ASC`;

    const result = await query(sql, params);
    res.json({ categories: result.rows });
  } catch (err) {
    console.error('Get budgets error:', err);
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
        ON CONFLICT (id) DO UPDATE SET amount = EXCLUDED.amount
      `, [id, req.userId, category_id, amount, month]);
    }
    res.json({ message: 'Budgets updated successfully' });
  } catch (err) {
    console.error('Save budgets error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update budget
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { amount, category_id } = req.body;
  try {
    const result = await query(
      `UPDATE budgets SET amount = $1, category_id = COALESCE($2, category_id) WHERE id = $3 AND user_id = $4 RETURNING *`,
      [amount, category_id, id, req.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Budget not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update budget error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Delete budget
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await query('DELETE FROM budgets WHERE id = $1 AND user_id = $2 RETURNING *', [id, req.userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Budget not found" });
    res.json({ message: "Budget deleted" });
  } catch (err) {
    console.error('Delete budget error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
