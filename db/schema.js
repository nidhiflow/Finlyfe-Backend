import { pool } from './index.js';

export async function syncSchema() {
  const client = await pool.connect();
  try {
    // 1. Execute Consolidated Table Creation, Column Alterations, and Index Creations in 1 roundtrip
    const consolidatedSchemaQuery = `
      BEGIN;

      -- Users table
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        email_verified BOOLEAN DEFAULT false,
        phone TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;

      -- Accounts table
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        balance NUMERIC DEFAULT 0,
        icon TEXT,
        color TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS parent_id TEXT REFERENCES accounts(id) ON DELETE CASCADE;

      -- Categories table
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        icon TEXT,
        color TEXT,
        parent_id TEXT REFERENCES categories(id) ON DELETE CASCADE
      );

      -- Transactions table
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        amount NUMERIC NOT NULL,
        category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
        account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
        to_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
        date TEXT NOT NULL,
        note TEXT,
        photo TEXT,
        repeat_group_id TEXT,
        repeat_end_date TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'expense';
      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS note TEXT;
      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS to_account_id TEXT;
      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS photo TEXT;
      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS repeat_group_id TEXT;
      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS repeat_end_date TEXT;
      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT false;

      -- AI Chat Messages table
      CREATE TABLE IF NOT EXISTS ai_chat_messages (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Budgets table
      CREATE TABLE IF NOT EXISTS budgets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category_id TEXT REFERENCES categories(id) ON DELETE CASCADE,
        amount NUMERIC NOT NULL DEFAULT 0,
        period TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Savings Goals table
      CREATE TABLE IF NOT EXISTS savings_goals (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        target_amount NUMERIC NOT NULL,
        current_amount NUMERIC DEFAULT 0,
        month TEXT,
        category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
        account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
      ALTER TABLE savings_goals ADD COLUMN IF NOT EXISTS month TEXT;
      ALTER TABLE savings_goals ADD COLUMN IF NOT EXISTS category_id TEXT REFERENCES categories(id) ON DELETE SET NULL;
      ALTER TABLE savings_goals ADD COLUMN IF NOT EXISTS account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL;

      -- Settings table
      CREATE TABLE IF NOT EXISTS settings (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT,
        PRIMARY KEY (user_id, key)
      );

      -- OTP Codes table
      CREATE TABLE IF NOT EXISTS otp_codes (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        code TEXT NOT NULL,
        type TEXT NOT NULL,
        name TEXT,
        password TEXT,
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Login Devices table
      CREATE TABLE IF NOT EXISTS login_devices (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_hash TEXT NOT NULL,
        device_info TEXT NOT NULL,
        ip_address TEXT,
        first_seen TIMESTAMP DEFAULT NOW(),
        last_seen TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, device_hash)
      );

      -- Bookmarks table
      CREATE TABLE IF NOT EXISTS bookmarks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, transaction_id)
      );

      -- Performance Indexes
      CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
      CREATE INDEX IF NOT EXISTS idx_transactions_category_id ON transactions(category_id);
      CREATE INDEX IF NOT EXISTS idx_categories_user_id ON categories(user_id);
      CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);
      CREATE INDEX IF NOT EXISTS idx_budgets_user_id ON budgets(user_id);
      CREATE INDEX IF NOT EXISTS idx_savings_goals_user_id ON savings_goals(user_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_is_recurring ON transactions(is_recurring);

      COMMIT;
    `;

    await client.query(consolidatedSchemaQuery);

    // 2. Conditional Schema Migrations (Run separately to handle errors gracefully)
    
    // Rename password_hash to password for legacy users
    try {
      const { rows: cols } = await client.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'password_hash'
      `);
      if (cols.length > 0) {
        await client.query(`ALTER TABLE users RENAME COLUMN password_hash TO password`);
      }
    } catch(e) { /* ignore */ }

    // Make account_id nullable on transactions
    try { 
      await client.query(`ALTER TABLE transactions ALTER COLUMN account_id DROP NOT NULL`); 
    } catch(e) { /* ignore */ }

    // Drop FK constraints on transactions so frontend local IDs don't cause errors
    try {
      const { rows: fks } = await client.query(`
        SELECT constraint_name FROM information_schema.table_constraints
        WHERE table_name = 'transactions' AND constraint_type = 'FOREIGN KEY'
        AND (constraint_name LIKE '%account_id%' OR constraint_name LIKE '%category_id%' OR constraint_name LIKE '%to_account_id%')
      `);
      for (const fk of fks) {
        await client.query(`ALTER TABLE transactions DROP CONSTRAINT IF EXISTS "${fk.constraint_name}"`);
      }
    } catch(e) { /* ignore */ }

    // Rename budgets.month to budgets.period if legacy column exists
    try {
      const { rows: budgetCols } = await client.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'budgets' AND column_name = 'month'
      `);
      if (budgetCols.length > 0) {
        const { rows: periodCols } = await client.query(`
          SELECT column_name FROM information_schema.columns
          WHERE table_name = 'budgets' AND column_name = 'period'
        `);
        if (periodCols.length === 0) {
          await client.query(`ALTER TABLE budgets RENAME COLUMN month TO period`);
        }
      }
    } catch(e) { /* ignore */ }

    // Drop old budget constraints
    try {
      await client.query(`ALTER TABLE budgets DROP CONSTRAINT IF EXISTS budgets_user_id_category_id_month_key`);
    } catch(e) { /* ignore */ }

    console.log("✅ Database schema synchronized successfully.");
  } catch (error) {
    console.error("❌ Error syncing database schema:", error);
    throw error;
  } finally {
    client.release();
  }
}
