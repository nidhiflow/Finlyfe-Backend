import "dotenv/config";
import express from "express";
import cors from "cors";
import { syncSchema } from "./db/schema.js";
import authRoutes from "./routes/auth.js";
// import transactionRoutes from "./routes/transactions.js";

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
// app.use("/api/transactions", transactionRoutes);

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
