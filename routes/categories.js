import express from 'express';
import { query } from '../db/index.js';

const router = express.Router();

const mockUserMiddleware = (req, res, next) => {
  req.user = req.user || { id: '1' };
  next();
};

router.use(mockUserMiddleware);

// Get all categories
router.get('/', async (req, res) => {
  try {
    const result = await query('SELECT * FROM categories WHERE user_id = $1 ORDER BY created_at ASC', [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create category
router.post('/', async (req, res) => {
  const { name, type, icon, color, parent_id } = req.body;
  const id = Date.now().toString();
  try {
    const result = await query(
      `INSERT INTO categories (id, user_id, name, type, icon, color, parent_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [id, req.user.id, name, type, icon, color, parent_id || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update category
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, type, icon, color, parent_id } = req.body;
  try {
    const result = await query(
      `UPDATE categories 
       SET name = $1, type = $2, icon = $3, color = $4, parent_id = $5
       WHERE id = $6 AND user_id = $7 RETURNING *`,
      [name, type, icon, color, parent_id || null, id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Category not found" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete category
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await query('DELETE FROM categories WHERE id = $1 AND user_id = $2 RETURNING *', [id, req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Category not found" });
    res.json({ message: "Success" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
