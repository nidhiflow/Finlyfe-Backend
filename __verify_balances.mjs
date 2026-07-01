import { pool, isSavings } from './db/index.js';

async function oldLogic(userId) {
  const accountsRes = await pool.query('SELECT * FROM accounts WHERE user_id = $1 ORDER BY created_at ASC', [userId]);
  const accounts = accountsRes.rows;
  const transactionsRes = await pool.query(`
    SELECT t.*, c.name as category_name
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    WHERE t.user_id = $1
  `, [userId]);
  const transactions = transactionsRes.rows;
  const balanceAdjustments = {};
  for (const acc of accounts) balanceAdjustments[acc.id] = 0;
  for (const t of transactions) {
    const amt = parseFloat(t.amount || 0);
    const isSaving = isSavings(t.category_id, t.category_name, t.note);
    if (t.type === 'income') {
      if (t.account_id && balanceAdjustments[t.account_id] !== undefined) balanceAdjustments[t.account_id] += amt;
    } else if (t.type === 'expense') {
      if (!isSaving) {
        if (t.account_id && balanceAdjustments[t.account_id] !== undefined) balanceAdjustments[t.account_id] -= amt;
      }
    } else if (t.type === 'transfer') {
      if (t.account_id && balanceAdjustments[t.account_id] !== undefined) balanceAdjustments[t.account_id] -= amt;
      if (t.to_account_id && balanceAdjustments[t.to_account_id] !== undefined) balanceAdjustments[t.to_account_id] += amt;
    }
  }
  return accounts.map(acc => {
    const initialBal = parseFloat(acc.balance || 0);
    const adj = balanceAdjustments[acc.id] || 0;
    return { id: acc.id, name: acc.name, balance: initialBal + adj };
  });
}

const IS_SAVING_SQL = `(
  LOWER(COALESCE(t.category_id, '')) LIKE '%saving%' OR LOWER(COALESCE(t.category_id, '')) LIKE '%invest%' OR
  LOWER(COALESCE(c.name, '')) LIKE '%saving%' OR LOWER(COALESCE(c.name, '')) LIKE '%invest%' OR
  LOWER(COALESCE(t.note, '')) LIKE '%saving%' OR LOWER(COALESCE(t.note, '')) LIKE '%invest%'
)`;

function buildBalancesSql() {
  return `
    SELECT a.id, a.name, (a.balance + COALESCE(adj.adjustment, 0)) AS balance
    FROM accounts a
    LEFT JOIN (
      SELECT account_id, SUM(delta) AS adjustment
      FROM (
        SELECT t.account_id AS account_id, t.amount AS delta
        FROM transactions t
        LEFT JOIN categories c ON t.category_id = c.id
        WHERE t.user_id = $1 AND t.type = 'income' AND t.account_id IS NOT NULL
        UNION ALL
        SELECT t.account_id AS account_id, -t.amount AS delta
        FROM transactions t
        LEFT JOIN categories c ON t.category_id = c.id
        WHERE t.user_id = $1 AND t.type = 'expense' AND t.account_id IS NOT NULL
          AND NOT ${IS_SAVING_SQL}
        UNION ALL
        SELECT t.account_id AS account_id, -t.amount AS delta
        FROM transactions t
        WHERE t.user_id = $1 AND t.type = 'transfer' AND t.account_id IS NOT NULL
        UNION ALL
        SELECT t.to_account_id AS account_id, t.amount AS delta
        FROM transactions t
        WHERE t.user_id = $1 AND t.type = 'transfer' AND t.to_account_id IS NOT NULL
      ) deltas
      GROUP BY account_id
    ) adj ON adj.account_id = a.id
    WHERE a.user_id = $1
    ORDER BY a.created_at ASC
  `;
}

async function newLogic(userId) {
  const result = await pool.query(buildBalancesSql(), [userId]);
  return result.rows.map(r => ({ id: r.id, name: r.name, balance: parseFloat(r.balance) }));
}

async function main() {
  const usersRes = await pool.query(`SELECT id FROM users WHERE id IN ('b0aae0df-5118-44b7-81a6-f8e57f854845','cba85274-31ee-4273-8093-304df8779d10','6a75fe77-2655-442d-b525-4988268c1ad9','19f4f171-afd0-4db2-af48-3791dac97fee')`);
  for (const u of usersRes.rows) {
    const oldRes = await oldLogic(u.id);
    const newRes = await newLogic(u.id);
    const oldMap = Object.fromEntries(oldRes.map(a => [a.id, a.balance]));
    const newMap = Object.fromEntries(newRes.map(a => [a.id, a.balance]));
    const allIds = new Set([...Object.keys(oldMap), ...Object.keys(newMap)]);
    let mismatch = false;
    for (const id of allIds) {
      const o = oldMap[id] ?? null;
      const n = newMap[id] ?? null;
      if (o === null || n === null || Math.abs(o - n) > 0.001) {
        console.log(`MISMATCH user=${u.id} account=${id} old=${o} new=${n}`);
        mismatch = true;
      }
    }
    if (!mismatch && allIds.size > 0) console.log(`OK user=${u.id} (${allIds.size} accounts)`);
    if (allIds.size === 0) console.log(`(no accounts) user=${u.id}`);
  }
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
