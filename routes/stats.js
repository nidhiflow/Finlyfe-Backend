import express from 'express';
import { query, isSavings, getCategoryMetadata } from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);

// SQL predicate mirroring isSavings() from db/index.js (catId/categoryName/note containing "saving" or "invest")
const IS_SAVING_SQL = `(
  LOWER(COALESCE(t.category_id, '')) LIKE '%saving%' OR LOWER(COALESCE(t.category_id, '')) LIKE '%invest%' OR
  LOWER(COALESCE(c.name, '')) LIKE '%saving%' OR LOWER(COALESCE(c.name, '')) LIKE '%invest%' OR
  LOWER(COALESCE(t.note, '')) LIKE '%saving%' OR LOWER(COALESCE(t.note, '')) LIKE '%invest%'
)`;

// Get summary
router.get('/summary', async (req, res) => {
  try {
    const { month, startDate, endDate } = req.query;
    let sql = `SELECT
                 COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0) AS income,
                 COALESCE(SUM(CASE WHEN t.type = 'expense' AND NOT ${IS_SAVING_SQL} THEN t.amount ELSE 0 END), 0) AS expense,
                 COALESCE(SUM(CASE WHEN t.type = 'expense' AND ${IS_SAVING_SQL} THEN t.amount ELSE 0 END), 0) AS savings
               FROM transactions t
               LEFT JOIN categories c ON t.category_id = c.id
               WHERE t.user_id = $1`;
    const params = [req.userId];
    let idx = 2;

    if (startDate || endDate) {
      if (startDate) { sql += ` AND t.date >= $${idx++}`; params.push(startDate); }
      if (endDate) { sql += ` AND t.date <= $${idx++}`; params.push(endDate); }
    } else if (month) {
      sql += ` AND LEFT(t.date, 7) = $${idx++}`;
      params.push(month);
    }

    const result = await query(sql, params);
    const row = result.rows[0];

    const income = parseFloat(row.income);
    const expense = parseFloat(row.expense);
    const savings = parseFloat(row.savings);
    const balance = income - expense;

    res.json({
      income,
      expense,
      balance,
      savings
    });
  } catch (err) {
    console.error('Stats summary error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get finly score (0-100 scale)
router.get('/finly-score', async (req, res) => {
  try {
    const { month, startDate, endDate } = req.query;
    let sql = `SELECT
                 COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0) AS income,
                 COALESCE(SUM(CASE WHEN t.type = 'expense' AND NOT ${IS_SAVING_SQL} THEN t.amount ELSE 0 END), 0) AS expense,
                 COUNT(*) AS tx_count
               FROM transactions t
               LEFT JOIN categories c ON t.category_id = c.id
               WHERE t.user_id = $1`;
    const params = [req.userId];
    let idx = 2;
    if (startDate || endDate) {
      if (startDate) { sql += ` AND t.date >= $${idx++}`; params.push(startDate); }
      if (endDate) { sql += ` AND t.date <= $${idx++}`; params.push(endDate); }
    } else if (month) {
      sql += ` AND LEFT(t.date, 7) = $${idx++}`;
      params.push(month);
    }

    const result = await query(sql, params);
    const row = result.rows[0];

    const incomeNum = parseFloat(row.income);
    const expenseNum = parseFloat(row.expense);
    const txCount = parseInt(row.tx_count, 10);

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
  const { month, startDate, endDate } = req.query;
  try {
    let sql = `SELECT t.category_id, t.type, SUM(t.amount) as total, c.name as category_name, c.icon, c.color
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       WHERE t.user_id = $1`;
    const params = [req.userId];
    let idx = 2;

    if (startDate || endDate) {
      if (startDate) { sql += ` AND t.date >= $${idx++}`; params.push(startDate); }
      if (endDate) { sql += ` AND t.date <= $${idx++}`; params.push(endDate); }
    } else if (month) {
      sql += ` AND LEFT(t.date, 7) = $${idx++}`;
      params.push(month);
    }

    sql += ` GROUP BY t.category_id, t.type, c.name, c.icon, c.color ORDER BY total DESC`;

    const result = await query(sql, params);
    
    const breakdown = result.rows.map(row => {
      const catId = row.category_id;
      const meta = getCategoryMetadata(catId, row.category_name, row.icon, row.color);
      return {
        category_id: catId,
        category_name: meta.name,
        icon: meta.icon,
        color: meta.color,
        type: row.type,
        total: parseFloat(row.total)
      };
    });
    
    res.json(breakdown);
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

// Personalized notifications
router.get('/notifications', async (req, res) => {
  const userId = req.userId || (req.user && req.user.id);
  try {
    const notifications = [];
    const now = new Date();
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // 1. Budget Alerts
    const budgetsSql = `
      SELECT b.id, b.category_id, b.amount, b.period
      FROM budgets b
      WHERE b.user_id = $1
    `;
    const budgets = await query(budgetsSql, [userId]);

    const expensesSql = `
      SELECT category_id, amount, note
      FROM transactions
      WHERE user_id = $1 AND LEFT(date, 7) = $2 AND type = 'expense'
    `;
    const expenses = await query(expensesSql, [userId, monthStr]);

    const expensesMap = {};
    expenses.rows.forEach(t => {
      const catId = t.category_id;
      const isSaving = isSavings(catId, null, t.note);
      if (isSaving) return; // Exclude savings from budget calculation

      const amt = parseFloat(t.amount || 0);
      expensesMap[catId] = (expensesMap[catId] || 0) + amt;
    });
    
    budgets.rows.forEach(b => {
      const spent = expensesMap[b.category_id] || 0;
      const amount = parseFloat(b.amount);
      const meta = getCategoryMetadata(b.category_id, null, null, null);
      
      if (amount > 0) {
        const pct = spent / amount;
        if (pct >= 1) {
          notifications.push({
            title: "Budget Exceeded",
            desc: `You've exceeded your ${meta.name} budget.`,
            time: "Today",
            color: "#EF4444"
          });
        } else if (pct >= 0.8) {
          notifications.push({
            title: "Budget Alert",
            desc: `You've used ${Math.round(pct * 100)}% of your ${meta.name} budget`,
            time: "Today",
            color: "#FFB703"
          });
        }
      }
    });

    // 2. Savings Goals
    const goals = await query('SELECT name, current_amount, target_amount FROM savings_goals WHERE user_id = $1', [userId]);
    goals.rows.forEach(g => {
      const current = parseFloat(g.current_amount);
      const target = parseFloat(g.target_amount);
      if (target > 0) {
        const pct = current / target;
        if (pct >= 1) {
          notifications.push({
            title: "Goal Reached!",
            desc: `Congratulations! You reached your ${g.name} goal!`,
            time: "Today",
            color: "#22C55E"
          });
        } else if (pct >= 0.5) {
          notifications.push({
            title: "Goal Milestone",
            desc: `You're ${Math.round(pct * 100)}% to your ${g.name} goal!`,
            time: "Today",
            color: "#4CC9F0"
          });
        }
      }
    });

    res.json(notifications);
  } catch (err) {
    console.error('Notifications error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
