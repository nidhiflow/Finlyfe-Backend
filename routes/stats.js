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
       FROM transactions WHERE user_id = $1 AND to_char(date::date, 'YYYY-MM') = $2`;
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

// Get finly score
router.get('/finly-score', async (req, res) => {
  try {
    const { month } = req.query;
    // Calculate a simple score based on income vs expenses ratio
    let sql, params;
    if (month) {
      sql = `SELECT 
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as expense
       FROM transactions WHERE user_id = $1 AND to_char(date::date, 'YYYY-MM') = $2`;
      params = [req.userId, month];
    } else {
      sql = `SELECT 
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as expense
       FROM transactions WHERE user_id = $1`;
      params = [req.userId];
    }

    const result = await query(sql, params);
    const { income, expense } = result.rows[0];
    const incomeNum = parseFloat(income);
    const expenseNum = parseFloat(expense);

    let score = 500; // base score
    if (incomeNum > 0) {
      const ratio = expenseNum / incomeNum;
      if (ratio <= 0.5) score = 900;
      else if (ratio <= 0.7) score = 800;
      else if (ratio <= 0.85) score = 700;
      else if (ratio <= 1.0) score = 600;
      else score = 400;
    }

    const label = score >= 800 ? 'Excellent' : score >= 700 ? 'Good' : score >= 600 ? 'Fair' : 'Needs Work';

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
    let sql = `SELECT c.name as category, c.color, SUM(t.amount) as total
       FROM transactions t
       JOIN categories c ON t.category_id = c.id
       WHERE t.user_id = $1 AND t.type = 'expense'`;
    const params = [req.userId];
    let idx = 2;

    if (month) {
      sql += ` AND to_char(t.date::date, 'YYYY-MM') = $${idx++}`;
      params.push(month);
    }

    sql += ` GROUP BY c.name, c.color ORDER BY total DESC`;

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
      sql += ` AND to_char(date::date, 'YYYY-MM') = $${idx++}`;
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
