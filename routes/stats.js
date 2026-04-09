import express from 'express';
import { query } from '../db/index.js';

const router = express.Router();

const mockUserMiddleware = (req, res, next) => {
  req.user = req.user || { id: '1' };
  next();
};

router.use(mockUserMiddleware);

// Get summary
router.get('/summary', async (req, res) => {
  try {
    const result = await query(
      `SELECT 
        COALESCE(SUM(CASE WHEN is_expense = false THEN amount ELSE 0 END), 0) as total_income,
        COALESCE(SUM(CASE WHEN is_expense = true THEN amount ELSE 0 END), 0) as total_expense
       FROM transactions WHERE user_id = $1`,
      [req.user.id]
    );
    const summary = result.rows[0];
    const total_balance = parseFloat(summary.total_income) - parseFloat(summary.total_expense);
    res.json({
      totalBalance: total_balance,
      monthlyIncome: parseFloat(summary.total_income),
      monthlyExpenses: parseFloat(summary.total_expense)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get finly score
router.get('/finly-score', async (req, res) => {
  // Simple mock algorithm
  try {
    res.json({ score: 750, label: "Good" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Category breakdown
router.get('/category-breakdown', async (req, res) => {
  const { month } = req.query;
  try {
    const result = await query(
      `SELECT c.name as category, c.color, SUM(t.amount) as total
       FROM transactions t
       JOIN categories c ON t.category_id = c.id
       WHERE t.user_id = $1 AND t.is_expense = true
       GROUP BY c.name, c.color`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Daily expenses
router.get('/daily-expenses', async (req, res) => {
  try {
    // Generate simple mock data array for demo or do actual grouping
    res.json([]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
