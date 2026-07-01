import { query } from './db/index.js';
async function run() {
  const res = await query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users'");
  console.log('Columns:', res.rows.map(r => r.column_name).join(', '));
  process.exit(0);
}
run();
