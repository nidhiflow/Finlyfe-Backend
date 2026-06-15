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

## Chatbot Response Personalization (`routes/ai.js`, `test_chatbot.js`)
* **Feature Goal**: Personalize the Finly AI Chatbot response dynamically using the user's actual database context (recent transactions, categories, budgets, and accounts) rather than returning fixed/generic guides.
* **Solutions Applied**:
  1. **User Financial Context Queries**: Modified the `/chat` route in `routes/ai.js` to asynchronously query the logged-in user's accounts (including balances and types), up to 50 recent transactions, category budgets, and active savings goals.
  2. **Prompt Injection**: Compiled these details into a structured `userProfileSummary` text block and injected it directly into the LLM system prompt.
  3. **Data-backed Coaching Instructions**: Configured guidelines instructing Llama to quote actual account balances, target categories, specific numbers, and goals when users ask for financial advice.
  4. **ReferenceError Fix**: Reordered message body extraction in `/chat` to resolve a ReferenceError when the API key was not configured (mock fallback mode).
* **Verification Status**:
  * Verified locally using `test_chatbot.js` for both login and chatbot request flow.
  * Fully verified in-app on the active user interface (e.g., when a user asks *"How can I save more?"*, the chatbot extracts the user's exact database records—such as ₹5,000 and ₹200 expenses, a ₹10,000 income, and their SBI Savings account name—providing customized, context-aware advice).

## Database Health Ping & Repository Sync
* **Solutions Applied**:
  1. Updated `/api/health` inside `index.js` to query the database (`SELECT 1`) on incoming health check requests, reporting database connection status and response latency in the response payload.
  2. Created a new migration file `004_optimize_and_sync_schema.sql` in the `finly-db` repository containing all database optimizations (recurring flag, phone columns, and performance indexes).
  3. Updated `schema/001_initial_schema.sql` in the `finly-db` repository to keep it fully aligned with the production schema structure.
  4. Committed and pushed all updates to the remote `finly-db` repository.

## AI Receipt Scanning Feature (`routes/ai.js`, `api.ts`, `AddTransactionScreen.tsx`)
* **Goal**: Implement the "Scan Receipt with AI" feature, transitioning it from a frontend mockup simulation into a real-time OCR and data extraction tool.
* **Solutions Applied**:
  1. **Backend Model Alignment**: Confirmed and aligned the `/api/ai/scan-receipt` endpoint in the backend (`routes/ai.js`) to use Groq's active vision-capable model: `'meta-llama/llama-4-scout-17b-16e-instruct'`.
  2. **Express Body Size Limit Fix (413 Payload Too Large)**: Increased Express's JSON and urlencoded payload limit to **50MB** (`app.use(express.json({ limit: '50mb' }))` in `index.js`). This resolved the 413 error occurring when uploading base64 receipt image payloads (which are larger than Express's default 100KB limit).
  3. **Frontend API Integration**: Extended the frontend `aiAPI` service wrapper in `src/app/services/api.ts` to include the `scanReceipt(base64)` endpoint.
  4. **File Selection & Upload Handler**: Integrated a hidden file input element in `AddTransactionScreen.tsx` triggered by clicking the "Scan Receipt with AI" button, letting users pick receipt images.
  5. **Base64 Processing & Auto-fill**: Handled converting chosen image files into base64 format inside the browser, passing it to `aiAPI.scanReceipt`, and automatically populating `amount`, `note`, `date`, `category_id`, and `subcategoryId` using fuzzy category matching on success.
  6. **Committed & Pushed**: Pushed all updates to backend (`main` and `Mukunthan` branches) and frontend (`main` branch) remote repositories.
