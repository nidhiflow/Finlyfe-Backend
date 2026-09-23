import { query } from './db/index.js';

async function run() {
  const { rows: promoted } = await query(
    'UPDATE users SET is_admin = true WHERE email = $1 RETURNING id, name, email, is_admin',
    ['nidhiflow.in@gmail.com']
  );
  console.log('Promoted:', promoted[0]);

  const { rowCount } = await query('DELETE FROM users WHERE email = $1', ['admin_finly']);
  console.log('Deleted stale admin_finly rows:', rowCount);

  process.exit(0);
}

run();
