import express from 'express';
import { query } from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);

// Get summary
router.get('/summary', async (req, res) => {
  try {
    const { month } = req.query;
    let sql, params;

    if (month) {
      sql = `SELECT 
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as total_income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as total_expense
       FROM transactions WHERE user_id = $1 AND LEFT(date, 7) = $2`;
      params = [req.userId, month];
    } else {
      sql = `SELECT 
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as total_income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as total_expense
       FROM transactions WHERE user_id = $1`;
      params = [req.userId];
    }

    const result = await query(sql, params);
    const summary = result.rows[0];
    const income = parseFloat(summary.total_income);
    const expense = parseFloat(summary.total_expense);
    const balance = income - expense;
    res.json({
      income,
      expense,
      balance,
      savings: Math.max(0, balance)
    });
  } catch (err) {
    console.error('Stats summary error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get finly score (0-100 scale)
router.get('/finly-score', async (req, res) => {
  try {
    const { month } = req.query;
    let sql, params;
    if (month) {
      sql = `SELECT 
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as expense,
        COUNT(*) as tx_count
       FROM transactions WHERE user_id = $1 AND LEFT(date, 7) = $2`;
      params = [req.userId, month];
    } else {
      sql = `SELECT 
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as expense,
        COUNT(*) as tx_count
       FROM transactions WHERE user_id = $1`;
      params = [req.userId];
    }

    const result = await query(sql, params);
    const { income, expense, tx_count } = result.rows[0];
    const incomeNum = parseFloat(income);
    const expenseNum = parseFloat(expense);
    const txCount = parseInt(tx_count);

    let score = 0;
    if (incomeNum > 0) {
      // Savings rate component (0-50 points)
      const savingsRate = (incomeNum - expenseNum) / incomeNum;
      const savingsPoints = Math.max(0, Math.min(50, Math.round(savingsRate * 100)));

      // Expense ratio component (0-30 points) - lower ratio = better
      const ratio = expenseNum / incomeNum;
      const ratioPoints = ratio <= 0.5 ? 30 : ratio <= 0.7 ? 25 : ratio <= 0.85 ? 18 : ratio <= 1.0 ? 10 : 0;

      // Activity/tracking component (0-20 points)
      const activityPoints = Math.min(20, txCount * 2);

      score = Math.min(100, Math.max(0, savingsPoints + ratioPoints + activityPoints));
    } else if (txCount > 0) {
      score = Math.min(15, txCount * 2); // Some tracking but no income yet
    }

    const label = score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Fair' : score >= 20 ? 'Needs Work' : 'Getting Started';

    res.json({ score, label });
  } catch (err) {
    console.error('Finly score error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Category breakdown
router.get('/category-breakdown', async (req, res) => {
  const { month } = req.query;
  try {
    let sql = `SELECT c.id as category_id, c.name as category_name, c.icon, c.color, t.type, SUM(t.amount) as total
       FROM transactions t
       JOIN categories c ON t.category_id = c.id
       WHERE t.user_id = $1`;
    const params = [req.userId];
    let idx = 2;

    if (month) {
      sql += ` AND LEFT(t.date, 7) = $${idx++}`;
      params.push(month);
    }

    sql += ` GROUP BY c.id, c.name, c.icon, c.color, t.type ORDER BY total DESC`;

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Category breakdown error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Daily expenses
router.get('/daily-expenses', async (req, res) => {
  const { month } = req.query;
  try {
    let sql = `SELECT date::date as day, SUM(amount) as total
       FROM transactions
       WHERE user_id = $1 AND type = 'expense'`;
    const params = [req.userId];
    let idx = 2;

    if (month) {
      sql += ` AND LEFT(date, 7) = $${idx++}`;
      params.push(month);
    }

    sql += ` GROUP BY date::date ORDER BY day ASC`;

    const result = await query(sql, params);
    res.json(result.rows.map(r => ({
      day: r.day,
      total: parseFloat(r.total)
    })));
  } catch (err) {
    console.error('Daily expenses error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
