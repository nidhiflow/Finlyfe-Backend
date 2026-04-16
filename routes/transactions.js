import express from 'express';
import { query } from '../db/index.js';
import { uploadImage, deleteImage } from '../services/cloudinary.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);

// Get all transactions
router.get('/', async (req, res) => {
  try {
    const { month, category_id, startDate, endDate, type, search, limit, offset } = req.query;
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
    if (type) {
      sql += ` AND type = $${idx++}`;
      params.push(type);
    }
    if (search) {
      sql += ` AND note ILIKE $${idx}`;
      params.push(`%${search}%`);
      idx++;
    }

    sql += ' ORDER BY date DESC, created_at DESC';

    if (limit) { sql += ` LIMIT $${idx++}`; params.push(parseInt(limit)); }
    if (offset) { sql += ` OFFSET $${idx++}`; params.push(parseInt(offset)); }

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
      "SELECT * FROM transactions WHERE user_id = $1 AND (is_recurring = true OR repeat_group_id IS NOT NULL) ORDER BY date DESC",
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    // Fallback if is_recurring column doesn't exist
    try {
      const result = await query(
        "SELECT * FROM transactions WHERE user_id = $1 AND repeat_group_id IS NOT NULL ORDER BY date DESC",
        [req.userId]
      );
      res.json(result.rows);
    } catch (err2) {
      res.json([]);
    }
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

// Create transaction — accepts whatever columns exist in the DB
router.post('/', async (req, res) => {
  try {
    const { type, amount, category_id, account_id, to_account_id, date, note, photo, repeat_months } = req.body;

    if (!amount || !date) {
      return res.status(400).json({ error: 'Amount and date are required' });
    }

    const id = Date.now().toString();
    let photoUrl = null;
    if (photo) photoUrl = await uploadImage(photo);

    const description = note || '';

    // Try inserting with all possible columns, fall back gracefully
    try {
      const result = await query(
        `INSERT INTO transactions (id, user_id, type, amount, category_id, account_id, to_account_id, note, date, photo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [id, req.userId, type || 'expense', amount, category_id || null, account_id || null, to_account_id || null, description, date, photoUrl]
      );
      return res.status(201).json(result.rows[0]);
    } catch (insertErr) {
      console.error('Insert attempt 1 failed:', insertErr.message);
      // Fallback: try without to_account_id and note (old schema)
      const result = await query(
        `INSERT INTO transactions (id, user_id, type, amount, category_id, account_id, date)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [id, req.userId, type || 'expense', amount, category_id || null, account_id || null, date]
      );
      return res.status(201).json(result.rows[0]);
    }
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

    try {
      const result = await query(
        `UPDATE transactions 
         SET type = $1, amount = $2, category_id = $3, account_id = $4, to_account_id = $5, note = $6, date = $7, photo = $8
         WHERE id = $9 AND user_id = $10 RETURNING *`,
        [type || 'expense', amount, category_id || null, account_id || null, to_account_id || null, note || '', date, photoUrl, req.params.id, req.userId]
      );
      return res.json(result.rows[0]);
    } catch (updateErr) {
      // Fallback for old schema
      const result = await query(
        `UPDATE transactions SET type = $1, amount = $2, category_id = $3, account_id = $4, date = $5
         WHERE id = $6 AND user_id = $7 RETURNING *`,
        [type || 'expense', amount, category_id || null, account_id || null, date, req.params.id, req.userId]
      );
      return res.json(result.rows[0]);
    }
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
