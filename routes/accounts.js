import express from 'express';
import { query } from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);

// SQL predicate mirroring isSavings() from db/index.js (catId/categoryName/note containing "saving" or "invest")
const IS_SAVING_SQL = `(
  LOWER(COALESCE(t.category_id, '')) LIKE '%saving%' OR LOWER(COALESCE(t.category_id, '')) LIKE '%invest%' OR
  LOWER(COALESCE(c.name, '')) LIKE '%saving%' OR LOWER(COALESCE(c.name, '')) LIKE '%invest%' OR
  LOWER(COALESCE(t.note, '')) LIKE '%saving%' OR LOWER(COALESCE(t.note, '')) LIKE '%invest%'
)`;

// Computes each account's running balance (opening balance + income/expense/transfer deltas) in one
// grouped SQL query instead of pulling every transaction into Node and looping per account.
function buildBalancesSql(singleAccount) {
  return `
    SELECT a.*, (a.balance + COALESCE(adj.adjustment, 0)) AS balance
    FROM accounts a
    LEFT JOIN (
      SELECT account_id, SUM(delta) AS adjustment
      FROM (
        SELECT t.account_id AS account_id, t.amount AS delta
        FROM transactions t
        LEFT JOIN categories c ON t.category_id = c.id
        WHERE t.user_id = $1 AND t.type = 'income' AND t.account_id IS NOT NULL

        UNION ALL

        SELECT t.account_id AS account_id, -t.amount AS delta
        FROM transactions t
        LEFT JOIN categories c ON t.category_id = c.id
        WHERE t.user_id = $1 AND t.type = 'expense' AND t.account_id IS NOT NULL
          AND NOT ${IS_SAVING_SQL}

        UNION ALL

        SELECT t.account_id AS account_id, -t.amount AS delta
        FROM transactions t
        WHERE t.user_id = $1 AND t.type = 'transfer' AND t.account_id IS NOT NULL

        UNION ALL

        SELECT t.to_account_id AS account_id, t.amount AS delta
        FROM transactions t
        WHERE t.user_id = $1 AND t.type = 'transfer' AND t.to_account_id IS NOT NULL
      ) deltas
      GROUP BY account_id
    ) adj ON adj.account_id = a.id
    WHERE a.user_id = $1${singleAccount ? ' AND a.id = $2' : ''}
    ORDER BY a.created_at ASC
  `;
}

async function getAccountWithBalance(userId, accountId) {
  const result = await query(buildBalancesSql(true), [userId, accountId]);
  if (result.rows.length === 0) return null;
  return { ...result.rows[0], balance: parseFloat(result.rows[0].balance) };
}

async function getAccountsWithBalances(userId) {
  const result = await query(buildBalancesSql(false), [userId]);
  return result.rows.map(row => ({ ...row, balance: parseFloat(row.balance) }));
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
      const txCheck = await query('SELECT count(*) FROM transactions WHERE account_id = $1 AND user_id = $2', [id, req.userId]);
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
