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

router.post('/restore', async (req, res) => {
  const { transactions, accounts, categories, budgets, goals } = req.body;
  const userId = req.user.id || req.userId;

  try {
    await query('BEGIN');

    // 1. Delete existing user data
    await query('DELETE FROM transactions WHERE user_id = $1', [userId]);
    await query('DELETE FROM budgets WHERE user_id = $1', [userId]);
    await query('DELETE FROM savings_goals WHERE user_id = $1', [userId]);
    await query('DELETE FROM categories WHERE user_id = $1', [userId]);
    await query('DELETE FROM accounts WHERE user_id = $1', [userId]);

    // 2. Insert categories
    if (categories && Array.isArray(categories)) {
      for (const cat of categories) {
        await query(
          'INSERT INTO categories (id, user_id, name, type, icon, color, parent_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [cat.id, userId, cat.name, cat.type, cat.icon || null, cat.color || null, cat.parent_id || null]
        );
      }
    }

    // 3. Insert accounts
    if (accounts && Array.isArray(accounts)) {
      for (const acc of accounts) {
        await query(
          'INSERT INTO accounts (id, user_id, name, type, balance, icon, color, parent_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [acc.id, userId, acc.name, acc.type, acc.balance || 0, acc.icon || null, acc.color || null, acc.parent_id || null]
        );
      }
    }

    // 4. Insert transactions
    if (transactions && Array.isArray(transactions)) {
      for (const t of transactions) {
        await query(
          `INSERT INTO transactions (
            id, user_id, type, amount, category_id, subcategory_id, account_id, to_account_id, 
            date, note, photo, repeat_group_id, repeat_end_date, is_recurring, repeat_frequency, title
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [
            t.id, userId, t.type || 'expense', t.amount || 0, t.category_id || null, t.subcategory_id || null, t.account_id || null, t.to_account_id || null,
            t.date, t.note || null, t.photo || null, t.repeat_group_id || null, t.repeat_end_date || null, t.is_recurring || false, t.repeat_frequency || null, t.title || null
          ]
        );
      }
    }

    // 5. Insert budgets
    if (budgets && Array.isArray(budgets)) {
      for (const b of budgets) {
        await query(
          'INSERT INTO budgets (id, user_id, category_id, amount, period) VALUES ($1, $2, $3, $4, $5)',
          [b.id, userId, b.category_id, b.amount || 0, b.period]
        );
      }
    }

    // 6. Insert goals
    if (goals && Array.isArray(goals)) {
      for (const g of goals) {
        await query(
          'INSERT INTO savings_goals (id, user_id, name, target_amount, current_amount, month, category_id, account_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [g.id, userId, g.name, g.target_amount || 0, g.current_amount || 0, g.month || null, g.category_id || null, g.account_id || null]
        );
      }
    }

    await query('COMMIT');
    res.json({ message: "Data restored successfully" });
  } catch (err) {
    await query('ROLLBACK');
    console.error("Restore failed:", err);
    res.status(500).json({ error: "Failed to restore data: " + err.message });
  }
});

export default router;
