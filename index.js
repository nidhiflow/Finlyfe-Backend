import "dotenv/config";
import express from "express";
import cors from "cors";
import { syncSchema } from "./db/schema.js";
import authRoutes from "./routes/auth.js";
import transactionRoutes from "./routes/transactions.js";
import accountRoutes from "./routes/accounts.js";
import categoryRoutes from "./routes/categories.js";
import savingsGoalsRoutes from "./routes/savings-goals.js";
import statsRoutes from "./routes/stats.js";
import settingsRoutes from "./routes/settings.js";
import budgetsRoutes from "./routes/budgets.js";
import aiRoutes from "./routes/ai.js";
import adminRoutes from "./routes/admin.js";
import paymentsRoutes from "./routes/payments.js";
import couponsRoutes from "./routes/coupons.js";
import backupRoutes from "./routes/backup.js";
import { initRecurrenceCron } from "./workers/recurrenceCron.js";
import { initBackupCron } from "./workers/backupCron.js";

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Health check
app.get("/api/health", async (req, res) => {
  const start = Date.now();
  let dbStatus = "unknown";
  let dbLatency = null;
  try {
    const { query } = await import("./db/index.js");
    await query("SELECT 1");
    dbStatus = "connected";
    dbLatency = `${Date.now() - start}ms`;
  } catch (err) {
    dbStatus = `error: ${err.message}`;
  }
  res.json({ 
    ok: true, 
    message: "Finlyfe API is running",
    database: dbStatus,
    database_latency: dbLatency
  });
});

// Mount Routes
app.use("/api/auth", authRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/accounts", accountRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/savings-goals", savingsGoalsRoutes);
app.use("/api/stats", statsRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/budgets", budgetsRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/payments", paymentsRoutes);
app.use("/api/coupons", couponsRoutes);
app.use("/api/backup", backupRoutes);

// Start Server
async function startServer() {
  try {
    // Only attempt DB sync if DATABASE_URL is present
    if (process.env.DATABASE_URL) {
      await syncSchema();
      // Start background workers
      initRecurrenceCron();
      initBackupCron();
    } else {
      console.warn("⚠️ DATABASE_URL is not set. Database is not connected.");
    }
    
    app.listen(PORT, () => {
      console.log(`🚀 Finalyfe-Backend running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
