import express from 'express';
import { query } from '../db/index.js';
import { uploadImage, deleteImage } from '../services/cloudinary.js';

const router = express.Router();

// Middleware to mock a logged-in user so the queries don't fail parsing req.user
// Assuming a token was verified via auth middleware and sets req.user.id
const mockUserMiddleware = (req, res, next) => {
  // For development simplicity, fallback to the user '1' if token parsing is skipped here
  req.user = req.user || { id: '1' }; 
  next();
};

router.use(mockUserMiddleware);

// Get all transactions
router.get('/', async (req, res) => {
  try {
    const result = await query('SELECT * FROM transactions WHERE user_id = $1 ORDER BY date DESC', [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get recurring transactions
router.get('/recurring', async (req, res) => {
  try {
    const result = await query('SELECT * FROM transactions WHERE user_id = $1 AND is_recurring = true ORDER BY date DESC', [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single transaction
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await query('SELECT * FROM transactions WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Transaction not found" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create transaction
router.post('/', async (req, res) => {
  const { amount, is_expense, category_id, account_id, description, date, is_recurring, recurring_frequency, photo } = req.body;
  const id = Date.now().toString(); // simple ID generator
  try {
    let photoUrl = null;
    if (photo) photoUrl = await uploadImage(photo);

    const result = await query(
      `INSERT INTO transactions (id, user_id, amount, is_expense, category_id, account_id, description, date, is_recurring, recurring_frequency, photo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [id, req.user.id, amount, is_expense, category_id, account_id, description, date, is_recurring, recurring_frequency, photoUrl]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update transaction
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { amount, is_expense, category_id, account_id, description, date, photo } = req.body;
  try {
    const { rows: existingRows } = await query('SELECT * FROM transactions WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (existingRows.length === 0) return res.status(404).json({ error: "Transaction not found" });
    
    let photoUrl = photo !== undefined ? photo : existingRows[0].photo;
    if (photo && !photo.startsWith('http')) {
       photoUrl = await uploadImage(photo);
       if (existingRows[0].photo) await deleteImage(existingRows[0].photo);
    }

    const result = await query(
      `UPDATE transactions 
       SET amount = $1, is_expense = $2, category_id = $3, account_id = $4, description = $5, date = $6, photo = $7
       WHERE id = $8 AND user_id = $9 RETURNING *`,
      [amount, is_expense, category_id, account_id, description, date, photoUrl, id, req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete transaction
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows: existingRows } = await query('SELECT * FROM transactions WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (existingRows.length === 0) return res.status(404).json({ error: "Transaction not found" });

    await query('DELETE FROM transactions WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    
    if (existingRows[0].photo) await deleteImage(existingRows[0].photo);
    
    res.json({ message: "Success" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
