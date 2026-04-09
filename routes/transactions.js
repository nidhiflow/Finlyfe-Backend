import express from 'express';
import { query } from '../db/index.js';
import { uploadImage, deleteImage } from '../services/cloudinary.js';
import jwt from 'jsonwebtoken';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';

// Auth middleware that extracts user from JWT token
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    req.user = { id: '1' };
    req.userId = '1';
    return next();
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    req.userId = decoded.id;
    next();
  } catch (err) {
    req.user = { id: '1' };
    req.userId = '1';
    next();
  }
};

router.use(authMiddleware);

// Get all transactions
router.get('/', async (req, res) => {
  try {
    const { month, category_id, is_recurring, startDate, endDate } = req.query;
    let sql = 'SELECT * FROM transactions WHERE user_id = $1';
    const params = [req.userId];
    let idx = 2;

    if (month) {
      sql += ` AND to_char(date, 'YYYY-MM') = $${idx++}`;
      params.push(month);
    }
    if (startDate) {
      sql += ` AND date >= $${idx++}`;
      params.push(startDate);
    }
    if (endDate) {
      sql += ` AND date <= $${idx++}`;
      params.push(endDate);
    }
    if (category_id) {
      sql += ` AND category_id = $${idx++}`;
      params.push(category_id);
    }

    sql += ' ORDER BY date DESC';
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Get transactions error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get recurring transactions
router.get('/recurring', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM transactions WHERE user_id = $1 AND is_recurring = true ORDER BY date DESC',
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single transaction
router.get('/:id', async (req, res) => {
  try {
    const result = await query('SELECT * FROM transactions WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Transaction not found" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create transaction
router.post('/', async (req, res) => {
  try {
    const { type, amount, category_id, account_id, to_account_id, date, note, photo, repeat_months } = req.body;

    if (!amount || !date) {
      return res.status(400).json({ error: 'Amount and date are required' });
    }

    const id = Date.now().toString();
    let photoUrl = null;
    if (photo) photoUrl = await uploadImage(photo);

    // Map frontend fields to DB columns
    const is_expense = type === 'expense';
    const description = note || '';
    const is_recurring = repeat_months && repeat_months > 1 ? true : false;

    const result = await query(
      `INSERT INTO transactions (id, user_id, type, amount, is_expense, category_id, account_id, to_account_id, description, note, date, is_recurring, photo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [id, req.userId, type || (is_expense ? 'expense' : 'income'), amount, is_expense, category_id || null, account_id || null, to_account_id || null, description, description, date, is_recurring, photoUrl]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create transaction error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update transaction
router.put('/:id', async (req, res) => {
  try {
    const { rows: existingRows } = await query('SELECT * FROM transactions WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
    if (existingRows.length === 0) return res.status(404).json({ error: "Transaction not found" });

    const { type, amount, category_id, account_id, to_account_id, date, note, photo } = req.body;

    let photoUrl = photo !== undefined ? photo : existingRows[0].photo;
    if (photo && !photo.startsWith('http')) {
      photoUrl = await uploadImage(photo);
      if (existingRows[0].photo) await deleteImage(existingRows[0].photo);
    }

    const is_expense = type === 'expense';
    const description = note || '';

    const result = await query(
      `UPDATE transactions 
       SET type = $1, amount = $2, is_expense = $3, category_id = $4, account_id = $5, to_account_id = $6, description = $7, note = $8, date = $9, photo = $10
       WHERE id = $11 AND user_id = $12 RETURNING *`,
      [type || (is_expense ? 'expense' : 'income'), amount, is_expense, category_id || null, account_id || null, to_account_id || null, description, description, date, photoUrl, req.params.id, req.userId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update transaction error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Delete transaction
router.delete('/:id', async (req, res) => {
  try {
    const { rows: existingRows } = await query('SELECT * FROM transactions WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
    if (existingRows.length === 0) return res.status(404).json({ error: "Transaction not found" });

    await query('DELETE FROM transactions WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
    if (existingRows[0].photo) await deleteImage(existingRows[0].photo);

    res.json({ message: "Success" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
