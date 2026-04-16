import { pool } from './index.js';

export async function syncSchema() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Users — matches finly-db schema
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        email_verified BOOLEAN DEFAULT false,
        phone TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Safely add columns that may not exist yet on users
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT`);

    // If the old column name 'password_hash' exists, rename it to 'password'
    try {
      const { rows: cols } = await client.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'password_hash'
      `);
      if (cols.length > 0) {
        await client.query(`ALTER TABLE users RENAME COLUMN password_hash TO password`);
      }
    } catch(e) { /* ignore */ }

    // Accounts — matches finly-db schema (includes parent_id for sub-accounts)
    await client.query(`
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
      )
    `);

    // Safely add parent_id if missing
    await client.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS parent_id TEXT REFERENCES accounts(id) ON DELETE CASCADE`);

    // Categories — matches finly-db schema
    await client.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        icon TEXT,
        color TEXT,
        parent_id TEXT REFERENCES categories(id) ON DELETE CASCADE
      )
    `);

    // Transactions — matches finly-db schema
    await client.query(`
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
      )
    `);

    // Safely add columns that may not exist yet on transactions
    await client.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'expense'`);
    await client.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS note TEXT`);
    await client.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS to_account_id TEXT`);
    await client.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS photo TEXT`);
    await client.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS repeat_group_id TEXT`);
    await client.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS repeat_end_date TEXT`);

    // Make account_id nullable (existing DB may have NOT NULL constraint)
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

    // AI Chat Messages — matches finly-db schema
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_chat_messages (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Budgets — matches finly-db schema (uses 'period' column)
    await client.query(`
      CREATE TABLE IF NOT EXISTS budgets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        amount NUMERIC NOT NULL,
        period TEXT NOT NULL
      )
    `);

    // If old 'month' column exists, rename to 'period'
    try {
      const { rows: budgetCols } = await client.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'budgets' AND column_name = 'month'
      `);
      if (budgetCols.length > 0) {
        // Check if 'period' already exists
        const { rows: periodCols } = await client.query(`
          SELECT column_name FROM information_schema.columns
          WHERE table_name = 'budgets' AND column_name = 'period'
        `);
        if (periodCols.length === 0) {
          await client.query(`ALTER TABLE budgets RENAME COLUMN month TO period`);
        }
      }
    } catch(e) {}

    // Drop the unique constraint if it references 'month' and re-add with 'period'
    try {
      await client.query(`ALTER TABLE budgets DROP CONSTRAINT IF EXISTS budgets_user_id_category_id_month_key`);
    } catch(e) {}

    // Savings Goals — matches finly-db schema (includes month, category_id, account_id)
    await client.query(`
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
      )
    `);

    // Safely add columns that may not exist yet on savings_goals
    await client.query(`ALTER TABLE savings_goals ADD COLUMN IF NOT EXISTS month TEXT`);
    await client.query(`ALTER TABLE savings_goals ADD COLUMN IF NOT EXISTS category_id TEXT REFERENCES categories(id) ON DELETE SET NULL`);
    await client.query(`ALTER TABLE savings_goals ADD COLUMN IF NOT EXISTS account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL`);

    // Settings — matches finly-db schema
    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT,
        PRIMARY KEY (user_id, key)
      )
    `);

    // OTP Codes — matches finly-db schema
    await client.query(`
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
      )
    `);

    // Login Devices — matches finly-db schema
    await client.query(`
      CREATE TABLE IF NOT EXISTS login_devices (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_hash TEXT NOT NULL,
        device_info TEXT NOT NULL,
        ip_address TEXT,
        first_seen TIMESTAMP DEFAULT NOW(),
        last_seen TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, device_hash)
      )
    `);

    // Bookmarks — matches finly-db schema
    await client.query(`
      CREATE TABLE IF NOT EXISTS bookmarks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, transaction_id)
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
