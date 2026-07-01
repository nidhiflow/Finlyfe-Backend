import { pool } from './db/index.js';
const r = await pool.query(`
  SELECT a.user_id, count(distinct a.id) as accounts, count(t.id) as txs
  FROM accounts a
  LEFT JOIN transactions t ON t.user_id = a.user_id
  GROUP BY a.user_id
  ORDER BY txs DESC
  LIMIT 15
`);
console.log(r.rows);
await pool.end();
