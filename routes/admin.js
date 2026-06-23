import express from 'express';
import { query } from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';

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

router.use(requireAdmin);

// GET /api/admin/stats
router.get('/stats', async (req, res) => {
    try {
        // 1. Total users
        const { rows: totalUsersRow } = await query('SELECT COUNT(*) FROM users');
        const totalUsers = parseInt(totalUsersRow[0].count);

        // 2. Active users (logged in within last 30 days)
        const { rows: activeUsersRow } = await query(
            "SELECT COUNT(DISTINCT user_id) FROM login_devices WHERE last_seen > NOW() - INTERVAL '30 days'"
        );
        let activeUsers = parseInt(activeUsersRow[0].count);
        // Fallback: if no active users are tracked yet, set to totalUsers
        if (activeUsers === 0) {
            activeUsers = totalUsers;
        }

        // 3. Subscriptions breakdown
        const { rows: subRow } = await query(
            'SELECT COALESCE(subscription_tier, \'Free\') as tier, COUNT(*) as count FROM users GROUP BY subscription_tier'
        );
        const subscriptions = { Free: 0, Pro: 0, Premium: 0 };
        subRow.forEach(row => {
            if (row.tier === 'Free') subscriptions.Free = parseInt(row.count);
            else if (row.tier === 'Pro') subscriptions.Pro = parseInt(row.count);
            else if (row.tier === 'Premium') subscriptions.Premium = parseInt(row.count);
        });

        // 4. User List
        const { rows: userList } = await query(
            'SELECT id, name, email, COALESCE(subscription_tier, \'Free\') as subscription_tier, created_at FROM users ORDER BY created_at DESC'
        );

        res.json({
            totalUsers,
            activeUsers,
            subscriptions,
            userList
        });
    } catch (err) {
        console.error('Admin stats error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/admin/users/:id/tier
router.put('/users/:id/tier', async (req, res) => {
    try {
        const { id } = req.params;
        const { tier } = req.body;

        if (!['Free', 'Pro', 'Premium'].includes(tier)) {
            return res.status(400).json({ error: 'Invalid subscription tier' });
        }

        const { rows } = await query('UPDATE users SET subscription_tier = $1 WHERE id = $2 RETURNING id, name, email, subscription_tier', [tier, id]);
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
