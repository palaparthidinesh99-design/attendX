const jwt = require('jsonwebtoken');
const { query } = require('../config/db');

/**
 * Middleware that verifies JWT from Authorization header.
 * Attaches req.user = { id, _id, role, name, email } on success.
 */
async function authenticate(req, res, next) {
  try {
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    } else if (req.query && req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev_fallback_secret_key_12345');

    // Confirm user exists in PostgreSQL
    const result = await query(
      'SELECT id, name, email, role FROM users WHERE id = $1',
      [payload.id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    req.user = {
      id: user.id,
      _id: user.id, // For backward compatibility with existing frontend code
      name: user.name,
      email: user.email,
      role: user.role
    };

    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    next(err);
  }
}

/**
 * Role-guard middleware factory. Must come after authenticate().
 * Usage: router.use(authenticate, requireRole('teacher'))
 */
function requireRole(role) {
  return (req, res, next) => {
    const userRole = String(req.user?.role || '').toLowerCase();
    const targetRole = String(role || '').toLowerCase();
    if (userRole !== targetRole) {
      return res.status(403).json({ error: `Access restricted to ${role}s` });
    }
    next();
  };
}

module.exports = { authenticate, requireRole };
