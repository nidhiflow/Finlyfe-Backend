import { v4 as uuidv4 } from 'uuid';
import { pool } from './index.js';
import { defaultExpenseCategories, defaultIncomeCategories } from './defaultCategories.js';

export async function seedDefaultsForUser(userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const cat of defaultExpenseCategories) {
      const catId = uuidv4();
      await client.query(
        'INSERT INTO categories (id, user_id, name, type, icon, color, parent_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [catId, userId, cat.name, 'expense', cat.icon, cat.color, null]
      );
      for (const sub of cat.subs) {
        await client.query(
          'INSERT INTO categories (id, user_id, name, type, icon, color, parent_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [uuidv4(), userId, sub, 'expense', cat.icon, cat.color, catId]
        );
      }
    }

    for (const cat of defaultIncomeCategories) {
      const catId = uuidv4();
      await client.query(
        'INSERT INTO categories (id, user_id, name, type, icon, color, parent_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [catId, userId, cat.name, 'income', cat.icon, cat.color, null]
      );
      for (const sub of cat.subs) {
        await client.query(
          'INSERT INTO categories (id, user_id, name, type, icon, color, parent_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [uuidv4(), userId, sub, 'income', cat.icon, cat.color, catId]
        );
      }
    }

    // Default accounts
    await client.query(
      'INSERT INTO accounts (id, user_id, name, type, balance, icon, color) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [uuidv4(), userId, 'Cash', 'cash', 0, '💵', '#2ECC71']
    );
    await client.query(
      'INSERT INTO accounts (id, user_id, name, type, balance, icon, color) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [uuidv4(), userId, 'Bank Account', 'bank', 0, '🏦', '#3498DB']
    );
    await client.query(
      'INSERT INTO accounts (id, user_id, name, type, balance, icon, color) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [uuidv4(), userId, 'Credit Card', 'credit_card', 0, '💳', '#E74C3C']
    );

    // Default settings
    await client.query('INSERT INTO settings (user_id, key, value) VALUES ($1, $2, $3)', [userId, 'currency', 'INR']);
    await client.query('INSERT INTO settings (user_id, key, value) VALUES ($1, $2, $3)', [userId, 'currencySymbol', '₹']);
    await client.query('INSERT INTO settings (user_id, key, value) VALUES ($1, $2, $3)', [userId, 'startDayOfWeek', '1']);
    await client.query('INSERT INTO settings (user_id, key, value) VALUES ($1, $2, $3)', [userId, 'theme', 'dark']);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
