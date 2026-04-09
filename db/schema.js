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
        type VARCHAR(50) DEFAULT 'expense',
        amount NUMERIC NOT NULL,
        category_id VARCHAR(255) REFERENCES categories(id) ON DELETE SET NULL,
        account_id VARCHAR(255) REFERENCES accounts(id) ON DELETE CASCADE,
        to_account_id VARCHAR(255),
        note TEXT,
        date TIMESTAMP NOT NULL,
        repeat_group_id VARCHAR(255),
        repeat_end_date VARCHAR(50),
        photo TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Safely add columns that may not exist yet
    await client.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS type VARCHAR(50) DEFAULT 'expense'`);
    await client.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS note TEXT`);
    await client.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS to_account_id VARCHAR(255)`);
    await client.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS photo TEXT`);

    // Make account_id nullable (existing DB may have NOT NULL + FK constraint)
    try { await client.query(`ALTER TABLE transactions ALTER COLUMN account_id DROP NOT NULL`); } catch(e) {}
    // Drop FK constraints on account_id and category_id so frontend local IDs don't cause errors
    try {
      const { rows: fks } = await client.query(`
        SELECT constraint_name FROM information_schema.table_constraints
        WHERE table_name = 'transactions' AND constraint_type = 'FOREIGN KEY'
        AND (constraint_name LIKE '%account_id%' OR constraint_name LIKE '%category_id%' OR constraint_name LIKE '%to_account_id%')
      `);
      for (const fk of fks) {
        await client.query(`ALTER TABLE transactions DROP CONSTRAINT IF EXISTS "${fk.constraint_name}"`);
      }
    } catch(e) {}

    // Savings Goals
    await client.query(`
      CREATE TABLE IF NOT EXISTS savings_goals (
        id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        target_amount NUMERIC NOT NULL,
        current_amount NUMERIC DEFAULT 0,
        deadline TIMESTAMP,
        icon VARCHAR(50),
        color VARCHAR(50),
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

    // Budgets
    await client.query(`
      CREATE TABLE IF NOT EXISTS budgets (
        id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
        category_id VARCHAR(255) REFERENCES categories(id) ON DELETE CASCADE,
        amount NUMERIC NOT NULL,
        month VARCHAR(7) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, category_id, month)
      )
    `);

    // AI Chat Messages
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_chat_messages (
        id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
        role VARCHAR(50) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
