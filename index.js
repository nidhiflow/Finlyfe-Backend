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

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());

// Health check
app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Finlyfe API is running" });
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

// Mocks for Bookmarks to prevent fetch errors
app.get("/api/bookmarks", (req, res) => res.json([]));
app.post("/api/bookmarks", (req, res) => res.json({ message: "Bookmark saved" }));
app.delete("/api/bookmarks/:id", (req, res) => res.json({ message: "Bookmark removed" }));

// Start Server
async function startServer() {
  try {
    // Only attempt DB sync if DATABASE_URL is present
    if (process.env.DATABASE_URL) {
      await syncSchema();
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
