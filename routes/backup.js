import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { query } from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';
import { runGoogleDriveBackupForUser } from '../workers/backupCron.js';

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-development';
// Dedicated OAuth client for Drive backup — deliberately separate from
// GOOGLE_CLIENT_ID (which is used for "Sign in with Google") so this feature
// can be configured/rotated without touching the sign-in flow.
const GOOGLE_DRIVE_CLIENT_ID = process.env.GOOGLE_DRIVE_CLIENT_ID;
const GOOGLE_DRIVE_CLIENT_SECRET = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

function getRedirectUri(req) {
  // Prefer an explicit env var (required in production — must exactly match the
  // Authorized redirect URI configured in Google Cloud Console for this OAuth client).
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  return `${req.protocol}://${req.get('host')}/api/backup/google/callback`;
}

// Short-lived in-memory store binding a one-time OAuth state nonce to the user
// who initiated the consent flow — prevents another user's callback from being
// misattributed (CSRF on the OAuth redirect).
const pendingOAuth = new Map();
const NONCE_TTL_MS = 10 * 60 * 1000;

function createOAuthClient(redirectUri) {
  return new OAuth2Client(GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, redirectUri);
}

router.get('/google/status', authenticateToken, async (req, res) => {
  try {
    const { rows } = await query('SELECT google_drive_refresh_token FROM users WHERE id = $1', [req.userId]);
    res.json({ connected: !!rows[0]?.google_drive_refresh_token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/backup/google/connect?token=<jwt> — the browser is navigated here directly
// (not a fetch call), so auth comes via a query param rather than an Authorization header.
router.get('/google/connect', (req, res) => {
  if (!GOOGLE_DRIVE_CLIENT_ID || !GOOGLE_DRIVE_CLIENT_SECRET) {
    return res.status(500).send('Google Drive backup is not configured on the server (missing GOOGLE_DRIVE_CLIENT_ID/SECRET).');
  }

  const token = req.query.token;
  if (!token) return res.status(401).send('Missing auth token');

  let userId;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    userId = decoded.id || decoded.userId;
  } catch (err) {
    return res.status(403).send('Invalid or expired session — please reopen Settings and try again.');
  }

  const nonce = crypto.randomUUID();
  pendingOAuth.set(nonce, { userId, expires: Date.now() + NONCE_TTL_MS });

  const client = createOAuthClient(getRedirectUri(req));
  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // force a refresh_token even on repeat connections
    scope: [DRIVE_SCOPE],
    state: nonce,
  });

  res.redirect(authUrl);
});

router.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`${FRONTEND_URL}/dashboard/settings?gdrive=error&reason=${encodeURIComponent(error)}`);
  }

  const pending = state && pendingOAuth.get(state);
  if (!pending || pending.expires < Date.now()) {
    pendingOAuth.delete(state);
    return res.redirect(`${FRONTEND_URL}/dashboard/settings?gdrive=error&reason=expired`);
  }
  pendingOAuth.delete(state);

  try {
    const client = createOAuthClient(getRedirectUri(req));
    const { tokens } = await client.getToken(code);

    if (!tokens.refresh_token) {
      // Happens if the user previously granted consent and Google didn't reissue
      // a refresh_token (prompt=consent above should prevent this, but guard anyway).
      return res.redirect(`${FRONTEND_URL}/dashboard/settings?gdrive=error&reason=no_refresh_token`);
    }

    await query('UPDATE users SET google_drive_refresh_token = $1 WHERE id = $2', [tokens.refresh_token, pending.userId]);

    res.redirect(`${FRONTEND_URL}/dashboard/settings?gdrive=connected`);
  } catch (err) {
    console.error('Google Drive OAuth callback error:', err);
    res.redirect(`${FRONTEND_URL}/dashboard/settings?gdrive=error&reason=exchange_failed`);
  }
});

router.post('/google/disconnect', authenticateToken, async (req, res) => {
  try {
    await query('UPDATE users SET google_drive_refresh_token = NULL WHERE id = $1', [req.userId]);
    res.json({ message: 'Disconnected automatic Google Drive backup' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lets a user trigger their daily backup on demand (e.g. right after connecting)
// instead of waiting for the next scheduled cron tick.
router.post('/google/run-now', authenticateToken, async (req, res) => {
  try {
    const { rows } = await query('SELECT google_drive_refresh_token FROM users WHERE id = $1', [req.userId]);
    if (!rows[0]?.google_drive_refresh_token) {
      return res.status(400).json({ error: 'Google Drive is not connected for automatic backup' });
    }
    await runGoogleDriveBackupForUser(req.userId, rows[0].google_drive_refresh_token);
    res.json({ message: 'Backup uploaded to Google Drive' });
  } catch (err) {
    console.error('Manual Drive backup error:', err);
    res.status(500).json({ error: err.message || 'Backup failed' });
  }
});

export default router;
