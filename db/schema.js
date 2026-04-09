import { pool } from './index.js';

export async function syncSchema() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Users
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(255) PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        phone VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Accounts
    await client.query(`
      CREATE TABLE IF NOT EXISTS accounts (
        id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL,
        balance NUMERIC DEFAULT 0,
        icon VARCHAR(50),
        color VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Categories
    await client.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL,
        icon VARCHAR(50),
        color VARCHAR(50),
        parent_id VARCHAR(255) REFERENCES categories(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Transactions
    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
        amount NUMERIC NOT NULL,
        is_expense BOOLEAN NOT NULL DEFAULT true,
        category_id VARCHAR(255) REFERENCES categories(id) ON DELETE SET NULL,
        account_id VARCHAR(255) REFERENCES accounts(id) ON DELETE CASCADE,
        description TEXT,
        date TIMESTAMP NOT NULL,
        is_recurring BOOLEAN DEFAULT false,
        recurring_frequency VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Settings
    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
        key VARCHAR(100) NOT NULL,
        value TEXT,
        PRIMARY KEY (user_id, key)
      )
    `);

    await client.query('COMMIT');
    console.log("✅ Database schema synchronized successfully.");
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("❌ Error syncing database schema:", error);
    throw error;
  } finally {
    client.release();
  }
}
