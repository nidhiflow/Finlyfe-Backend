import pg from 'pg';
import "dotenv/config";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' || process.env.DATABASE_URL?.includes('neon.tech') 
    ? { rejectUnauthorized: false } 
    : false,
  max: 10,
  connectionTimeoutMillis: 5000, // 5 seconds connection timeout
  idleTimeoutMillis: 10000       // 10 seconds idle timeout to release connection
});

export const query = (text, params) => pool.query(text, params);

export const FRONTEND_CATEGORIES = {
  "food": { name: "Food & Dining", icon: "🍽️", color: "#FF6B35" },
  "health": { name: "Health", icon: "🏥", color: "#06D6A0" },
  "personal": { name: "Personal Care", icon: "💅", color: "#C77DFF" },
  "provisions": { name: "Home Provisions", icon: "🛒", color: "#4CC9F0" },
  "household": { name: "Household", icon: "🏠", color: "#845EC2" },
  "invest": { name: "Investments", icon: "📈", color: "#2EC4B6" },
  "transport": { name: "Transport", icon: "🚗", color: "#4895EF" },
  "trips": { name: "Trips & Leisure", icon: "🏖️", color: "#00B4D8" },
  "vehicle": { name: "Vehicle", icon: "🚘", color: "#F7931A" },
  "bills": { name: "Bills", icon: "💡", color: "#FFB703" },
  "govt": { name: "Government", icon: "🏛️", color: "#7209B7" },
  "gifts-out": { name: "Gifts", icon: "🎁", color: "#FF6B9D" },
  "entertain": { name: "Entertainment", icon: "🎬", color: "#F72585" },
  "loans-out": { name: "Loans & Credits", icon: "💳", color: "#EF4444" },
  "kids": { name: "Kids", icon: "🎒", color: "#48CAE4" },
  "biz-out": { name: "Business", icon: "💼", color: "#7C5CFF" },
  "savings": { name: "Savings", icon: "💰", color: "#22C55E" },
  
  "i-salary": { name: "Salary", icon: "💼", color: "#22C55E" },
  "i-gifts": { name: "Gifts & Rewards", icon: "🎁", color: "#FF6B9D" },
  "i-loans": { name: "Loans & Returns", icon: "🔄", color: "#4895EF" },
  "i-refunds": { name: "Refunds", icon: "🔁", color: "#4CC9F0" },
  "i-biz": { name: "Business Income", icon: "🏢", color: "#7C5CFF" },
  "i-rental": { name: "Rental Income", icon: "🏡", color: "#F7931A" },
  "i-interest": { name: "Interest Income", icon: "📈", color: "#2EC4B6" }
};

export function getCategoryMetadata(catId, dbName, dbIcon, dbColor) {
  const fe = FRONTEND_CATEGORIES[catId];
  if (fe) {
    return {
      name: fe.name,
      icon: fe.icon,
      color: fe.color
    };
  }
  return {
    name: dbName || 'Uncategorized',
    icon: dbIcon || '📦',
    color: dbColor || '#7C5CFF'
  };
}

export function isSavings(catId, dbName, note) {
  const cat = String(catId || '').toLowerCase();
  const name = String(dbName || '').toLowerCase();
  const nt = String(note || '').toLowerCase();
  return cat.includes('saving') || cat.includes('invest') || 
         name.includes('saving') || name.includes('invest') || 
         nt.includes('saving') || nt.includes('invest');
}
