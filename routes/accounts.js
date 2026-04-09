import express from 'express';
import { query } from '../db/index.js';

const router = express.Router();

const mockUserMiddleware = (req, res, next) => {
  req.user = req.user || { id: '1' };
  next();
};

router.use(mockUserMiddleware);

// Get all accounts
router.get('/', async (req, res) => {
  try {
    const result = await query('SELECT * FROM accounts WHERE user_id = $1 ORDER BY created_at ASC', [req.user.id]);
    res.json(result.rows);
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
      [id, req.user.id, name, type, balance, icon, color]
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
    const result = await query(
      `UPDATE accounts 
       SET name = $1, type = $2, balance = $3, icon = $4, color = $5
       WHERE id = $6 AND user_id = $7 RETURNING *`,
      [name, type, balance, icon, color, id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Account not found" });
    res.json(result.rows[0]);
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
    const result = await query('DELETE FROM accounts WHERE id = $1 AND user_id = $2 RETURNING *', [id, req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Account not found" });
    res.json({ message: "Success" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
