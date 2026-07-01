import { query } from './db/index.js';
async function run() {
  await query("UPDATE users SET subscription_tier = 'pro' WHERE email = 'testuser@finly.com'");
  console.log("Updated to pro");
  process.exit(0);
}
run();
