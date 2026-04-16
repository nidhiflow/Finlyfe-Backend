import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-development';

/**
 * Shared JWT authentication middleware.
 * Extracts and verifies the Bearer token from the Authorization header.
 * Sets req.userId and req.user on success; returns 401/403 on failure.
 */
export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token missing' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.userId = decoded.id || decoded.userId;
    req.user = { id: req.userId, ...decoded };
    next();
  });
}
