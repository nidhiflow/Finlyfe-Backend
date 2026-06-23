import express from 'express';
import { query } from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

router.use(authenticateToken);

// Middleware to verify if user is admin
async function requireAdmin(req, res, next) {
    try {
        const { rows } = await query('SELECT email FROM users WHERE id = $1', [req.userId]);
        if (rows.length === 0 || rows[0].email !== 'admin_finly') {
            return res.status(403).json({ error: 'Forbidden: Admin access only' });
        }
        next();
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
}

// ─── PAGE TRACKING (no admin required — called by every authenticated user) ───

// POST /api/admin/track  — fire-and-forget page visit logging
router.post('/track', async (req, res) => {
    try {
        const { page } = req.body;
        if (!page || typeof page !== 'string') return res.status(400).json({ error: 'page is required' });
        const id = uuidv4();
        await query(
            'INSERT INTO page_analytics (id, user_id, page, visited_at) VALUES ($1, $2, $3, NOW())',
            [id, req.userId, page]
        );
        res.json({ ok: true });
    } catch (err) {
        // Silently fail — analytics shouldn't break the app
        console.error('Page tracking error:', err);
        res.json({ ok: false });
    }
});

// ─── All routes below require admin ──────────────────────────────────────────
router.use(requireAdmin);

// GET /api/admin/stats — original stats endpoint (kept for compatibility)
router.get('/stats', async (req, res) => {
    try {
        const { rows: totalUsersRow } = await query('SELECT COUNT(*) FROM users');
        const totalUsers = parseInt(totalUsersRow[0].count);

        const { rows: activeUsersRow } = await query(
            "SELECT COUNT(DISTINCT user_id) FROM login_devices WHERE last_seen > NOW() - INTERVAL '30 days'"
        );
        let activeUsers = parseInt(activeUsersRow[0].count);
        if (activeUsers === 0) activeUsers = totalUsers;

        const { rows: subRow } = await query(
            "SELECT COALESCE(subscription_tier, 'Free') as tier, COUNT(*) as count FROM users GROUP BY subscription_tier"
        );
        const subscriptions = { Free: 0, Pro: 0, Premium: 0 };
        subRow.forEach(row => {
            if (row.tier === 'Free') subscriptions.Free = parseInt(row.count);
            else if (row.tier === 'Pro') subscriptions.Pro = parseInt(row.count);
            else if (row.tier === 'Premium') subscriptions.Premium = parseInt(row.count);
        });

        const { rows: userList } = await query(
            "SELECT u.id, u.name, u.email, COALESCE(u.subscription_tier, 'Free') as subscription_tier, u.created_at, MAX(ld.last_seen) as last_seen FROM users u LEFT JOIN login_devices ld ON ld.user_id = u.id GROUP BY u.id, u.name, u.email, u.subscription_tier, u.created_at ORDER BY u.created_at DESC"
        );

        res.json({ totalUsers, activeUsers, subscriptions, userList });
    } catch (err) {
        console.error('Admin stats error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/admin/analytics — deep analytics for admin dashboard
router.get('/analytics', async (req, res) => {
    try {
        // ── User Counts ────────────────────────────────────────────────────────
        const { rows: [{ count: totalUsers }] } = await query('SELECT COUNT(*) FROM users');
        
        const { rows: [{ count: dauCount }] } = await query(
            "SELECT COUNT(DISTINCT user_id) FROM login_devices WHERE last_seen > NOW() - INTERVAL '1 day'"
        );
        const { rows: [{ count: wauCount }] } = await query(
            "SELECT COUNT(DISTINCT user_id) FROM login_devices WHERE last_seen > NOW() - INTERVAL '7 days'"
        );
        const { rows: [{ count: mauCount }] } = await query(
            "SELECT COUNT(DISTINCT user_id) FROM login_devices WHERE last_seen > NOW() - INTERVAL '30 days'"
        );

        // ── User Growth (last 30 days) ─────────────────────────────────────────
        const { rows: growthRows } = await query(`
            SELECT 
                DATE(created_at) as date,
                COUNT(*) as signups
            FROM users
            WHERE created_at > NOW() - INTERVAL '30 days'
            GROUP BY DATE(created_at)
            ORDER BY date ASC
        `);

        // Fill in zeros for missing days
        const growthMap = {};
        growthRows.forEach(r => { growthMap[r.date.toISOString().slice(0, 10)] = parseInt(r.signups); });
        const growth = [];
        for (let i = 29; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const key = d.toISOString().slice(0, 10);
            growth.push({ date: key, signups: growthMap[key] || 0 });
        }

        // ── Page Analytics ─────────────────────────────────────────────────────
        // All-time page visits
        const { rows: pageAllTime } = await query(`
            SELECT page, COUNT(*) as visits
            FROM page_analytics
            GROUP BY page
            ORDER BY visits DESC
        `);

        // Last 7 days page visits
        const { rows: pageWeekly } = await query(`
            SELECT page, COUNT(*) as visits
            FROM page_analytics
            WHERE visited_at > NOW() - INTERVAL '7 days'
            GROUP BY page
            ORDER BY visits DESC
        `);

        // Unique users per page (engagement breadth)
        const { rows: pageUniqueUsers } = await query(`
            SELECT page, COUNT(DISTINCT user_id) as unique_users
            FROM page_analytics
            GROUP BY page
            ORDER BY unique_users DESC
        `);

        // Total page views
        const { rows: [{ count: totalPageViews }] } = await query('SELECT COUNT(*) FROM page_analytics');

        // ── Feature Turnout ────────────────────────────────────────────────────
        const { rows: [{ count: usersWithBudget }] } = await query(
            'SELECT COUNT(DISTINCT user_id) FROM budgets'
        );
        const { rows: [{ count: usersWithGoals }] } = await query(
            'SELECT COUNT(DISTINCT user_id) FROM savings_goals'
        );
        const { rows: [{ count: usersWithAI }] } = await query(
            'SELECT COUNT(DISTINCT user_id) FROM ai_chat_messages'
        );
        const { rows: [{ count: usersWithRecurring }] } = await query(
            "SELECT COUNT(DISTINCT user_id) FROM transactions WHERE is_recurring = true"
        );
        const { rows: [{ count: usersWithTransactions }] } = await query(
            "SELECT COUNT(DISTINCT user_id) FROM transactions WHERE is_recurring = false OR is_recurring IS NULL"
        );
        const { rows: [{ count: usersWithAccounts }] } = await query(
            'SELECT COUNT(DISTINCT user_id) FROM accounts'
        );

        // ── Financial Overview ─────────────────────────────────────────────────
        const { rows: [{ count: totalTransactions }] } = await query('SELECT COUNT(*) FROM transactions');
        const { rows: [{ sum: totalTransactionVolume }] } = await query(
            "SELECT SUM(amount) FROM transactions WHERE type = 'expense'"
        );
        const { rows: [{ avg: avgTransactionsPerUser }] } = await query(`
            SELECT AVG(tx_count) FROM (
                SELECT user_id, COUNT(*) as tx_count FROM transactions GROUP BY user_id
            ) sub
        `);

        // ── Subscription Breakdown ─────────────────────────────────────────────
        const { rows: subRows } = await query(
            "SELECT COALESCE(subscription_tier, 'Free') as tier, COUNT(*) as count FROM users GROUP BY subscription_tier"
        );
        const subscriptions = { Free: 0, Pro: 0, Premium: 0 };
        subRows.forEach(r => {
            if (r.tier === 'Free') subscriptions.Free = parseInt(r.count);
            else if (r.tier === 'Pro') subscriptions.Pro = parseInt(r.count);
            else if (r.tier === 'Premium') subscriptions.Premium = parseInt(r.count);
        });

        // ── Retention (came back within 7 days of signup) ─────────────────────
        const { rows: [{ count: retainedUsers }] } = await query(`
            SELECT COUNT(DISTINCT u.id)
            FROM users u
            JOIN login_devices ld ON ld.user_id = u.id
            WHERE ld.last_seen > u.created_at + INTERVAL '1 day'
              AND ld.last_seen < u.created_at + INTERVAL '8 days'
        `);
        const { rows: [{ count: eligibleForRetention }] } = await query(
            "SELECT COUNT(*) FROM users WHERE created_at < NOW() - INTERVAL '7 days'"
        );

        const total = parseInt(totalUsers);
        const dau = parseInt(dauCount);
        const wau = parseInt(wauCount);
        const mau = parseInt(mauCount) || total;

        res.json({
            overview: {
                totalUsers: total,
                dau,
                wau,
                mau: mau || total,
                totalPageViews: parseInt(totalPageViews),
                totalTransactions: parseInt(totalTransactions),
                totalTransactionVolume: parseFloat(totalTransactionVolume) || 0,
                avgTransactionsPerUser: parseFloat(avgTransactionsPerUser) || 0,
            },
            growth,
            pageStats: {
                allTime: pageAllTime.map(r => ({ page: r.page, visits: parseInt(r.visits) })),
                weekly: pageWeekly.map(r => ({ page: r.page, visits: parseInt(r.visits) })),
                uniqueUsers: pageUniqueUsers.map(r => ({ page: r.page, unique_users: parseInt(r.unique_users) })),
            },
            featureTurnout: {
                budgets: { users: parseInt(usersWithBudget), rate: total > 0 ? (parseInt(usersWithBudget) / total) * 100 : 0 },
                goals: { users: parseInt(usersWithGoals), rate: total > 0 ? (parseInt(usersWithGoals) / total) * 100 : 0 },
                ai: { users: parseInt(usersWithAI), rate: total > 0 ? (parseInt(usersWithAI) / total) * 100 : 0 },
                recurring: { users: parseInt(usersWithRecurring), rate: total > 0 ? (parseInt(usersWithRecurring) / total) * 100 : 0 },
                transactions: { users: parseInt(usersWithTransactions), rate: total > 0 ? (parseInt(usersWithTransactions) / total) * 100 : 0 },
                accounts: { users: parseInt(usersWithAccounts), rate: total > 0 ? (parseInt(usersWithAccounts) / total) * 100 : 0 },
            },
            subscriptions,
            retention: {
                retained: parseInt(retainedUsers),
                eligible: parseInt(eligibleForRetention),
                rate: parseInt(eligibleForRetention) > 0
                    ? (parseInt(retainedUsers) / parseInt(eligibleForRetention)) * 100
                    : 0,
            },
        });
    } catch (err) {
        console.error('Admin analytics error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/admin/users/:id/tier — update subscription tier
router.put('/users/:id/tier', async (req, res) => {
    try {
        const { id } = req.params;
        const { tier } = req.body;

        if (!['Free', 'Pro', 'Premium'].includes(tier)) {
            return res.status(400).json({ error: 'Invalid subscription tier' });
        }

        const { rows } = await query(
            'UPDATE users SET subscription_tier = $1 WHERE id = $2 RETURNING id, name, email, subscription_tier',
            [tier, id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ message: 'User subscription tier updated successfully', user: rows[0] });
    } catch (err) {
        console.error('Update user tier error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
