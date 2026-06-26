import express from 'express';
import { query } from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);

// Get budgets
router.get('/', async (req, res) => {
  const { month } = req.query; // format: 'YYYY-MM'
  try {
    // Ensure budgets table exists without FK constraints
    // First, try to drop all FK constraints on the table
    try {
      const fks = await query(`
        SELECT constraint_name FROM information_schema.table_constraints 
        WHERE table_name = 'budgets' AND constraint_type = 'FOREIGN KEY'
      `);
      for (const fk of fks.rows) {
        await query(`ALTER TABLE budgets DROP CONSTRAINT IF EXISTS "${fk.constraint_name}"`);
      }
    } catch(e) { /* table might not exist yet */ }

    await query(`
      CREATE TABLE IF NOT EXISTS budgets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        category_id TEXT,
        amount NUMERIC NOT NULL DEFAULT 0,
        period TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    // Add created_at column if missing (old tables don't have it)
    try { await query(`ALTER TABLE budgets ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`); } catch(e) {}

    const params = [req.userId];
    let sql = `SELECT id, category_id, amount, period FROM budgets WHERE user_id = $1`;
    if (month) {
      sql += ` AND (period = $2 OR period IS NULL)`;
      params.push(month);
    }
    sql += ` ORDER BY id ASC`;

    const result = await query(sql, params);

    // Compute actual spend per category for the displayed month from transactions
    const spendMonth = month || null;
    const withSpent = await Promise.all(result.rows.map(async (b) => {
      const targetMonth = spendMonth || b.period;
      if (!b.category_id || !targetMonth) return { ...b, spent: 0 };
      const spendResult = await query(
        `SELECT COALESCE(SUM(amount), 0) AS spent FROM transactions
         WHERE user_id = $1 AND category_id = $2 AND type = 'expense' AND LEFT(date, 7) = $3`,
        [req.userId, b.category_id, targetMonth]
      );
      return { ...b, spent: spendResult.rows[0].spent };
    }));

    res.json({ categories: withSpent });
  } catch (err) {
    console.error('Get budgets error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Save budgets (batch update or create)
router.post('/', async (req, res) => {
  const data = req.body; 
  try {
    // Drop all FK constraints dynamically
    try {
      const fks = await query(`
        SELECT constraint_name FROM information_schema.table_constraints 
        WHERE table_name = 'budgets' AND constraint_type = 'FOREIGN KEY'
      `);
      for (const fk of fks.rows) {
        await query(`ALTER TABLE budgets DROP CONSTRAINT IF EXISTS "${fk.constraint_name}"`);
      }
    } catch(e) {}
    await query(`
      CREATE TABLE IF NOT EXISTS budgets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        category_id TEXT,
        amount NUMERIC NOT NULL DEFAULT 0,
        period TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

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
