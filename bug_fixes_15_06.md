# Bug Fixes - 15/06/2026

## Latency Issue in Database Loading
* **Symptom**: The app took up to 30 seconds to load the database/dashboard on startup or initial connections.
* **Root Causes**:
  1. **Unoptimized Schema Sync**: On server start, `syncSchema()` ran ~30 separate database queries sequentially. Over remote cloud databases (Neon), the cumulative network roundtrip overhead caused significant startup delay.
  2. **Missing Database Indexes**: Key query filters like `user_id`, `date`, `category_id` had no index, causing full-table scans.
  3. **Schema Errors & Failbacks**: `/api/transactions/recurring` queries attempted to filter by a missing `is_recurring` column, causing queries to fail and trigger slow catch-and-fallback logic.
  4. **Sub-optimal Connection Pool**: Lack of maximum connection timeouts caused connections to wait indefinitely on DNS/compute node wake-up delays.

## Solutions Applied

### 1. Connection Pool Optimization (`db/index.js`)
* Configured `Pool` connection limits and timeouts:
  * `max: 10` (Pre-empts PgBouncer pool exhaustion)
  * `connectionTimeoutMillis: 5000` (5-second timeout limit)
  * `idleTimeoutMillis: 10000` (10-second idle connection release)

### 2. Consolidated Schema Queries (`db/schema.js`)
* Grouped all table creation, column alterations, and index statements into **one unified SQL transaction block**.
* Reduced database roundtrips on startup from ~30 down to **1 roundtrip**.
* Startup schema sync time dropped from **2737ms** to **196ms** (~93% improvement).

### 3. Missing Indexes & Column Addition (`db/schema.js`)
* Added `is_recurring BOOLEAN DEFAULT false` column to the `transactions` table.
* Created performance-tuning indexes:
  * `idx_transactions_user_id` on `transactions(user_id)`
  * `idx_transactions_date` on `transactions(date)`
  * `idx_transactions_category_id` on `transactions(category_id)`
  * `idx_categories_user_id` on `categories(user_id)`
  * `idx_accounts_user_id` on `accounts(user_id)`
  * `idx_budgets_user_id` on `budgets(user_id)`
  * `idx_savings_goals_user_id` on `savings_goals(user_id)`
  * `idx_transactions_is_recurring` on `transactions(is_recurring)`

### 4. Query Reliability Fixed (`routes/transactions.js`)
* The `/api/transactions/recurring` endpoint query now directly succeeds without error fallback.
* Endpoint latency dropped from **526ms** to **49ms** (~90.7% improvement).

### 5. Render Build Compatibility (`package.json`)
* Added a dummy `"build": "echo 'No build step required'"` script to `package.json`. This ensures that Render deployments do not fail if Render's default build command is set to `npm run build`.

### 6. Mobile Data Sync & Demo Bypass (`routes/auth.js`)
* **Verified Database Configuration**: Executed a production signup request and confirmed that the generated OTP was instantly queries-retrievable from the local connection. This confirmed that **both local and production backends target the exact same Neon database instance**.
* **Demo OTP Bypass**: Introduced a login bypass check for `demo@finly.app` / `demo123` to allow mobile logins to bypass OTP verification (which previously sent OTPs to a mock email address), enabling the user to sync and view their previous data.
