import express from 'express';
import { query, isSavings } from '../db/index.js';
import { uploadImage, deleteImage } from '../services/cloudinary.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);

function mapTransactionRow(row) {
  if (!row) return row;
  const isSaving = isSavings(row.category_id, row.category_name, row.note);
  if (isSaving && row.type === 'expense') {
    return { ...row, type: 'savings' };
  }
  return row;
}

// Get all transactions
router.get('/', async (req, res) => {
  try {
    const { month, category_id, startDate, endDate, type, search, limit, offset } = req.query;
    let sql = `SELECT t.*, c.name as category_name, a.name as account_name, a2.name as to_account_name 
               FROM transactions t 
               LEFT JOIN categories c ON t.category_id = c.id 
               LEFT JOIN accounts a ON t.account_id = a.id 
               LEFT JOIN accounts a2 ON t.to_account_id = a2.id 
               WHERE t.user_id = $1`;
    const params = [req.userId];
    let idx = 2;

    if (month) {
      sql += ` AND LEFT(t.date, 7) = $${idx++}`;
      params.push(month);
    }
    if (startDate) {
      sql += ` AND t.date >= $${idx++}`;
      params.push(startDate);
    }
    if (endDate) {
      sql += ` AND t.date <= $${idx++}`;
      params.push(endDate);
    }
    if (category_id) {
      sql += ` AND t.category_id = $${idx++}`;
      params.push(category_id);
    }
    if (type) {
      sql += ` AND t.type = $${idx++}`;
      params.push(type);
    }
    if (search) {
      sql += ` AND t.note ILIKE $${idx}`;
      params.push(`%${search}%`);
      idx++;
    }

    sql += ' ORDER BY t.date DESC, t.created_at DESC';

    if (limit) { sql += ` LIMIT $${idx++}`; params.push(parseInt(limit)); }
    if (offset) { sql += ` OFFSET $${idx++}`; params.push(parseInt(offset)); }

    const result = await query(sql, params);
    res.json(result.rows.map(mapTransactionRow));
  } catch (err) {
    console.error('Get transactions error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get recurring transactions
router.get('/recurring', async (req, res) => {
  try {
    const result = await query(
      `SELECT t.*, c.name as category_name, a.name as account_name, a2.name as to_account_name 
       FROM transactions t 
       LEFT JOIN categories c ON t.category_id = c.id 
       LEFT JOIN accounts a ON t.account_id = a.id 
       LEFT JOIN accounts a2 ON t.to_account_id = a2.id 
       WHERE t.user_id = $1 AND (t.is_recurring = true OR t.repeat_group_id IS NOT NULL) 
       ORDER BY t.date DESC`,
      [req.userId]
    );
    res.json(result.rows.map(mapTransactionRow));
  } catch (err) {
    // Fallback if is_recurring column doesn't exist
    try {
      const result = await query(
        `SELECT t.*, c.name as category_name, a.name as account_name, a2.name as to_account_name 
         FROM transactions t 
         LEFT JOIN categories c ON t.category_id = c.id 
         LEFT JOIN accounts a ON t.account_id = a.id 
         LEFT JOIN accounts a2 ON t.to_account_id = a2.id 
         WHERE t.user_id = $1 AND t.repeat_group_id IS NOT NULL 
         ORDER BY t.date DESC`,
        [req.userId]
      );
      res.json(result.rows.map(mapTransactionRow));
    } catch (err2) {
      res.json([]);
    }
  }
});

// Get single transaction
router.get('/:id', async (req, res) => {
  try {
    const sql = `SELECT t.*, c.name as category_name, a.name as account_name, a2.name as to_account_name 
                 FROM transactions t 
                 LEFT JOIN categories c ON t.category_id = c.id 
                 LEFT JOIN accounts a ON t.account_id = a.id 
                 LEFT JOIN accounts a2 ON t.to_account_id = a2.id 
                 WHERE t.id = $1 AND t.user_id = $2`;
    const result = await query(sql, [req.params.id, req.userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Transaction not found" });
    res.json(mapTransactionRow(result.rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create transaction — accepts whatever columns exist in the DB
router.post('/', async (req, res) => {
  try {
    const { type, amount, category_id, subcategory_id, subcategoryId, account_id, to_account_id, date, note, photo, is_recurring, repeat_frequency } = req.body;
    const subcatId = subcategory_id || subcategoryId || null;

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
        `INSERT INTO transactions (id, user_id, type, amount, category_id, subcategory_id, account_id, to_account_id, note, date, photo, is_recurring, repeat_frequency)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
        [id, req.userId, type || 'expense', amount, category_id || null, subcatId, account_id || null, to_account_id || null, description, date, photoUrl, is_recurring || false, repeat_frequency || null]
      );
      return res.status(201).json(mapTransactionRow(result.rows[0]));
    } catch (insertErr) {
      console.error('Insert attempt 1 failed:', insertErr.message);
      // Fallback: try without to_account_id and note (old schema)
      const result = await query(
        `INSERT INTO transactions (id, user_id, type, amount, category_id, account_id, date)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [id, req.userId, type || 'expense', amount, category_id || null, account_id || null, date]
      );
      return res.status(201).json(mapTransactionRow(result.rows[0]));
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

    const { type, amount, category_id, subcategory_id, subcategoryId, account_id, to_account_id, date, note, photo, is_recurring, repeat_frequency } = req.body;
    const subcatId = subcategory_id || subcategoryId || null;

    let photoUrl = photo !== undefined ? photo : existingRows[0].photo;
    if (photo && !photo.startsWith('http')) {
      photoUrl = await uploadImage(photo);
      if (existingRows[0].photo) await deleteImage(existingRows[0].photo);
    }

    try {
      const result = await query(
        `UPDATE transactions 
         SET type = $1, amount = $2, category_id = $3, subcategory_id = $4, account_id = $5, to_account_id = $6, note = $7, date = $8, photo = $9, is_recurring = $10, repeat_frequency = $11
         WHERE id = $12 AND user_id = $13 RETURNING *`,
        [type || 'expense', amount, category_id || null, subcatId, account_id || null, to_account_id || null, note || '', date, photoUrl, is_recurring || false, repeat_frequency || null, req.params.id, req.userId]
      );
      return res.json(mapTransactionRow(result.rows[0]));
    } catch (updateErr) {
      // Fallback for old schema
      const result = await query(
        `UPDATE transactions SET type = $1, amount = $2, category_id = $3, account_id = $4, date = $5
         WHERE id = $6 AND user_id = $7 RETURNING *`,
        [type || 'expense', amount, category_id || null, account_id || null, date, req.params.id, req.userId]
      );
      return res.json(mapTransactionRow(result.rows[0]));
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
