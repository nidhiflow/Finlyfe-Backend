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
    const { 
      type, amount, category_id, subcategory_id, subcategoryId, account_id, to_account_id, 
      title, date, note, photo, is_recurring, repeat_frequency,
      repeat_interval, repeat_day_of_month, repeat_end_type, repeat_occurrences_total,
      auto_create, reminder_days_before, status, next_due_date
    } = req.body;
    const subcatId = subcategory_id || subcategoryId || null;

    if (!amount || !date) {
      return res.status(400).json({ error: 'Amount and date are required' });
    }

    const id = Date.now().toString();
    let photoUrl = null;
    if (photo) photoUrl = await uploadImage(photo);

    const description = note || '';

    // Calculate next_due_date if not provided by frontend (though frontend will likely provide it)
    let calculatedNextDue = next_due_date || null;
    if (is_recurring && !calculatedNextDue) {
      const d = new Date(date);
      if (repeat_frequency === 'daily' || repeat_frequency === 'days') d.setDate(d.getDate() + (repeat_interval || 1));
      else if (repeat_frequency === 'weekly' || repeat_frequency === 'weeks') d.setDate(d.getDate() + 7 * (repeat_interval || 1));
      else if (repeat_frequency === 'monthly' || repeat_frequency === 'months') d.setMonth(d.getMonth() + (repeat_interval || 1));
      else if (repeat_frequency === 'quarterly') d.setMonth(d.getMonth() + 3);
      else if (repeat_frequency === 'yearly' || repeat_frequency === 'years') d.setFullYear(d.getFullYear() + (repeat_interval || 1));
      calculatedNextDue = d.toISOString();
    }

    try {
      const result = await query(
        `INSERT INTO transactions (
          id, user_id, type, amount, category_id, subcategory_id, account_id, to_account_id, 
          title, note, date, photo, is_recurring, repeat_frequency,
          repeat_interval, repeat_day_of_month, next_due_date, repeat_end_type, 
          repeat_occurrences_total, auto_create, reminder_days_before, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22) RETURNING *`,
        [
          id, req.userId, type || 'expense', amount, category_id || null, subcatId, account_id || null, to_account_id || null, 
          title || null, description, date, photoUrl, is_recurring || false, repeat_frequency || null,
          repeat_interval || null, repeat_day_of_month || null, calculatedNextDue, repeat_end_type || null,
          repeat_occurrences_total || null, auto_create !== false, reminder_days_before || null, status || 'active'
        ]
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

    const { 
      type, amount, category_id, subcategory_id, subcategoryId, account_id, to_account_id, 
      title, date, note, photo, is_recurring, repeat_frequency,
      repeat_interval, repeat_day_of_month, repeat_end_type, repeat_occurrences_total,
      auto_create, reminder_days_before, status, next_due_date
    } = req.body;
    const subcatId = subcategory_id || subcategoryId || null;

    let photoUrl = photo !== undefined ? photo : existingRows[0].photo;
    if (photo && !photo.startsWith('http')) {
      photoUrl = await uploadImage(photo);
      if (existingRows[0].photo) await deleteImage(existingRows[0].photo);
    }

    let calculatedNextDue = next_due_date !== undefined ? next_due_date : existingRows[0].next_due_date;
    if (is_recurring && !calculatedNextDue && existingRows[0].is_recurring !== is_recurring) {
      const d = new Date(date);
      if (repeat_frequency === 'daily' || repeat_frequency === 'days') d.setDate(d.getDate() + (repeat_interval || 1));
      else if (repeat_frequency === 'weekly' || repeat_frequency === 'weeks') d.setDate(d.getDate() + 7 * (repeat_interval || 1));
      else if (repeat_frequency === 'monthly' || repeat_frequency === 'months') d.setMonth(d.getMonth() + (repeat_interval || 1));
      else if (repeat_frequency === 'quarterly') d.setMonth(d.getMonth() + 3);
      else if (repeat_frequency === 'yearly' || repeat_frequency === 'years') d.setFullYear(d.getFullYear() + (repeat_interval || 1));
      calculatedNextDue = d.toISOString();
    }

    try {
      const result = await query(
        `UPDATE transactions 
         SET type = $1, amount = $2, category_id = $3, subcategory_id = $4, account_id = $5, to_account_id = $6, title = $7, note = $8, date = $9, photo = $10, is_recurring = $11, repeat_frequency = $12,
             repeat_interval = $13, repeat_day_of_month = $14, next_due_date = $15, repeat_end_type = $16, repeat_occurrences_total = $17, auto_create = $18, reminder_days_before = $19, status = $20
         WHERE id = $21 AND user_id = $22 RETURNING *`,
        [
          type || existingRows[0].type, amount !== undefined ? amount : existingRows[0].amount, 
          category_id !== undefined ? category_id : existingRows[0].category_id, 
          subcatId !== undefined ? subcatId : existingRows[0].subcategory_id, 
          account_id !== undefined ? account_id : existingRows[0].account_id, 
          to_account_id !== undefined ? to_account_id : existingRows[0].to_account_id, 
          title !== undefined ? title : existingRows[0].title,
          note !== undefined ? note : existingRows[0].note, 
          date || existingRows[0].date, photoUrl, 
          is_recurring !== undefined ? is_recurring : existingRows[0].is_recurring, 
          repeat_frequency !== undefined ? repeat_frequency : existingRows[0].repeat_frequency,
          repeat_interval !== undefined ? repeat_interval : existingRows[0].repeat_interval,
          repeat_day_of_month !== undefined ? repeat_day_of_month : existingRows[0].repeat_day_of_month,
          calculatedNextDue,
          repeat_end_type !== undefined ? repeat_end_type : existingRows[0].repeat_end_type,
          repeat_occurrences_total !== undefined ? repeat_occurrences_total : existingRows[0].repeat_occurrences_total,
          auto_create !== undefined ? auto_create : existingRows[0].auto_create,
          reminder_days_before !== undefined ? reminder_days_before : existingRows[0].reminder_days_before,
          status !== undefined ? status : existingRows[0].status,
          req.params.id, req.userId
        ]
      );
      res.json(mapTransactionRow(result.rows[0]));
    } catch (updateErr) {
      console.error('Update attempt 1 failed:', updateErr.message);
      const result = await query(
        `UPDATE transactions SET type = $1, amount = $2, category_id = $3, account_id = $4, date = $5 WHERE id = $6 AND user_id = $7 RETURNING *`,
        [type || existingRows[0].type, amount !== undefined ? amount : existingRows[0].amount, category_id !== undefined ? category_id : existingRows[0].category_id, account_id !== undefined ? account_id : existingRows[0].account_id, date || existingRows[0].date, req.params.id, req.userId]
      );
      res.json(mapTransactionRow(result.rows[0]));
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete transaction
router.delete('/:id', async (req, res) => {
  try {
    const result = await query('DELETE FROM transactions WHERE id = $1 AND user_id = $2 RETURNING *', [req.params.id, req.userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Transaction not found" });
    if (result.rows[0].photo) await deleteImage(result.rows[0].photo);
    res.json({ message: "Success" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
