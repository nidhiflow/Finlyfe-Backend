import express from 'express';
import { query } from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);

// Get all goals
router.get('/', async (req, res) => {
  try {
    const result = await query('SELECT * FROM savings_goals WHERE user_id = $1 ORDER BY created_at ASC', [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create goal
router.post('/', async (req, res) => {
  const { name, target_amount, current_amount, target_date, emoji, color, start_date, tracking_mode, type, linked_account, carry_forward, notes, status } = req.body;
  const id = Date.now().toString();
  try {
    const result = await query(
      `INSERT INTO savings_goals (id, user_id, name, target_amount, current_amount, target_date, emoji, color, start_date, tracking_mode, type, linked_account, carry_forward, notes, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
      [id, req.user.id, name, target_amount, current_amount || 0, target_date, emoji, color, start_date, tracking_mode, type, linked_account, carry_forward || false, notes, status || 'active']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update goal
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, target_amount, current_amount, target_date, emoji, color, start_date, tracking_mode, type, linked_account, carry_forward, notes, status } = req.body;
  try {
    const result = await query(
      `UPDATE savings_goals 
       SET name = $1, target_amount = $2, current_amount = $3, target_date = $4, emoji = $5, color = $6, start_date = $7, tracking_mode = $8, type = $9, linked_account = $10, carry_forward = $11, notes = $12, status = $13
       WHERE id = $14 AND user_id = $15 RETURNING *`,
      [name, target_amount, current_amount, target_date, emoji, color, start_date, tracking_mode, type, linked_account, carry_forward || false, notes, status || 'active', id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Goal not found" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Record Contribution
router.post('/:id/record', async (req, res) => {
  const { id } = req.params;
  const { amount } = req.body;
  try {
    // Basic increment implementation
    const result = await query(
      `UPDATE savings_goals SET current_amount = current_amount + $1 WHERE id = $2 AND user_id = $3 RETURNING *`,
      [amount, id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Goal not found" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete goal
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await query('DELETE FROM savings_goals WHERE id = $1 AND user_id = $2 RETURNING *', [id, req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Goal not found" });
    res.json({ message: "Success" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
