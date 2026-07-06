import cron from 'node-cron';
import { OAuth2Client } from 'google-auth-library';
import { query } from '../db/index.js';

// Dedicated OAuth client for Drive backup — separate from GOOGLE_CLIENT_ID (Sign in with Google).
const GOOGLE_DRIVE_CLIENT_ID = process.env.GOOGLE_DRIVE_CLIENT_ID;
const GOOGLE_DRIVE_CLIENT_SECRET = process.env.GOOGLE_DRIVE_CLIENT_SECRET;

async function getAccessToken(refreshToken) {
  const client = new OAuth2Client(GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET);
  client.setCredentials({ refresh_token: refreshToken });
  const { token } = await client.getAccessToken();
  if (!token) throw new Error('Failed to obtain Google access token from refresh token');
  return token;
}

async function buildBackupData(userId) {
  const [transactions, accounts, categories, budgets, goals] = await Promise.all([
    query('SELECT * FROM transactions WHERE user_id = $1', [userId]),
    query('SELECT * FROM accounts WHERE user_id = $1', [userId]),
    query('SELECT * FROM categories WHERE user_id = $1', [userId]),
    query('SELECT * FROM budgets WHERE user_id = $1', [userId]),
    query('SELECT * FROM savings_goals WHERE user_id = $1', [userId]),
  ]);

  return {
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    transactions: transactions.rows,
    accounts: accounts.rows,
    categories: categories.rows,
    budgets: budgets.rows,
    goals: goals.rows,
  };
}

async function uploadBackupToDrive(accessToken, backupData) {
  const metadata = {
    name: `finly-auto-backup-${new Date().toISOString().split('T')[0]}.json`,
    mimeType: 'application/json',
  };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([JSON.stringify(backupData)], { type: 'application/json' }));

  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Drive upload failed (${response.status}): ${text}`);
  }
  return response.json();
}

export async function runGoogleDriveBackupForUser(userId, refreshToken) {
  const accessToken = await getAccessToken(refreshToken);
  const backupData = await buildBackupData(userId);
  return uploadBackupToDrive(accessToken, backupData);
}

export async function runDailyGoogleDriveBackups() {
  console.log('[CRON] Running Google Drive auto-backup worker at', new Date().toISOString());
  try {
    const { rows: users } = await query(
      'SELECT id, google_drive_refresh_token FROM users WHERE google_drive_refresh_token IS NOT NULL'
    );
    console.log(`[CRON] Found ${users.length} user(s) with automatic Drive backup enabled.`);

    for (const user of users) {
      try {
        await runGoogleDriveBackupForUser(user.id, user.google_drive_refresh_token);
        console.log(`[CRON] Drive backup succeeded for user ${user.id}`);
      } catch (err) {
        console.error(`[CRON] Drive backup failed for user ${user.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[CRON] Drive auto-backup worker error:', err);
  }
}

export function initBackupCron() {
  // Once a day at 03:00 server time — off-peak, well clear of the 15-min recurrence worker.
  cron.schedule('0 3 * * *', () => {
    runDailyGoogleDriveBackups();
  });
}
