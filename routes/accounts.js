import express from 'express';
import { query, isSavings } from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);

async function getAccountWithBalance(userId, accountId) {
  const accountsRes = await query('SELECT * FROM accounts WHERE user_id = $1 AND id = $2', [userId, accountId]);
  if (accountsRes.rows.length === 0) return null;
  const acc = accountsRes.rows[0];

  const transactionsRes = await query(`
    SELECT t.*, c.name as category_name 
    FROM transactions t 
    LEFT JOIN categories c ON t.category_id = c.id 
    WHERE t.user_id = $1 AND (t.account_id = $2 OR t.to_account_id = $2)
  `, [userId, accountId]);
  const transactions = transactionsRes.rows;

  let balanceAdjustment = 0;
  for (const t of transactions) {
    const amt = parseFloat(t.amount || 0);
    const isSaving = isSavings(t.category_id, t.category_name, t.note);

    if (t.type === 'income') {
      if (t.account_id === accountId) {
        balanceAdjustment += amt;
      }
    } else if (t.type === 'expense') {
      if (!isSaving) {
        if (t.account_id === accountId) {
          balanceAdjustment -= amt;
        }
      }
    } else if (t.type === 'transfer') {
      if (t.account_id === accountId) {
        balanceAdjustment -= amt;
      }
      if (t.to_account_id === accountId) {
        balanceAdjustment += amt;
      }
    }
  }

  const initialBal = parseFloat(acc.balance || 0);
  return {
    ...acc,
    balance: initialBal + balanceAdjustment
  };
}

async function getAccountsWithBalances(userId) {
  const accountsRes = await query('SELECT * FROM accounts WHERE user_id = $1 ORDER BY created_at ASC', [userId]);
  const accounts = accountsRes.rows;

  const transactionsRes = await query(`
    SELECT t.*, c.name as category_name 
    FROM transactions t 
    LEFT JOIN categories c ON t.category_id = c.id 
    WHERE t.user_id = $1
  `, [userId]);
  const transactions = transactionsRes.rows;

  const balanceAdjustments = {};
  for (const acc of accounts) {
    balanceAdjustments[acc.id] = 0;
  }

  for (const t of transactions) {
    const amt = parseFloat(t.amount || 0);
    const isSaving = isSavings(t.category_id, t.category_name, t.note);

    if (t.type === 'income') {
      if (t.account_id && balanceAdjustments[t.account_id] !== undefined) {
        balanceAdjustments[t.account_id] += amt;
      }
    } else if (t.type === 'expense') {
      if (!isSaving) {
        if (t.account_id && balanceAdjustments[t.account_id] !== undefined) {
          balanceAdjustments[t.account_id] -= amt;
        }
      }
    } else if (t.type === 'transfer') {
      if (t.account_id && balanceAdjustments[t.account_id] !== undefined) {
        balanceAdjustments[t.account_id] -= amt;
      }
      if (t.to_account_id && balanceAdjustments[t.to_account_id] !== undefined) {
        balanceAdjustments[t.to_account_id] += amt;
      }
    }
  }

  return accounts.map(acc => {
    const initialBal = parseFloat(acc.balance || 0);
    const adj = balanceAdjustments[acc.id] || 0;
    return {
      ...acc,
      balance: initialBal + adj
    };
  });
}

// Get all accounts
router.get('/', async (req, res) => {
  try {
    const accountsWithBalances = await getAccountsWithBalances(req.userId);
    res.json(accountsWithBalances);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create account
router.post('/', async (req, res) => {
  const { name, type, balance, icon, color } = req.body;
  const id = Date.now().toString();
  try {
    const result = await query(
      `INSERT INTO accounts (id, user_id, name, type, balance, icon, color)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [id, req.userId, name, type, balance, icon, color]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update account
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, type, balance, icon, color } = req.body;
  try {
    let result;
    if (balance !== undefined && balance !== null && balance !== '') {
      // Balance explicitly provided — update everything including opening balance
      result = await query(
        `UPDATE accounts 
         SET name = $1, type = $2, balance = $3, icon = $4, color = $5
         WHERE id = $6 AND user_id = $7 RETURNING *`,
        [name, type, balance, icon, color, id, req.userId]
      );
    } else {
      // Balance NOT provided — preserve the existing opening balance to avoid double-counting
      result = await query(
        `UPDATE accounts 
         SET name = $1, type = $2, icon = $3, color = $4
         WHERE id = $5 AND user_id = $6 RETURNING *`,
        [name, type, icon, color, id, req.userId]
      );
    }
    if (result.rows.length === 0) return res.status(404).json({ error: "Account not found" });
    const updatedWithBalance = await getAccountWithBalance(req.userId, id);
    res.json(updatedWithBalance || result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete account
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { force } = req.query;
  try {
    if (force !== 'true') {
      const txCheck = await query('SELECT count(*) FROM transactions WHERE account_id = $1', [id]);
      if (parseInt(txCheck.rows[0].count) > 0) {
        return res.status(400).json({ error: "Account has linked transactions" });
      }
    }
    const result = await query('DELETE FROM accounts WHERE id = $1 AND user_id = $2 RETURNING *', [id, req.userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Account not found" });
    res.json({ message: "Success" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
