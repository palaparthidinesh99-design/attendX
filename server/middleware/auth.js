const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Middleware that verifies JWT from Authorization header.
 * Attaches req.user = { id, role, name, email } on success.
 */
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.slice(7);
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // Lightweight check — only fetch to confirm user still exists
    const user = await User.findById(payload.id).select('_id role name email');
    if (!user) return res.status(401).json({ error: 'User not found' });

    req.user = user;
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
    if (req.user.role !== role) {
      return res.status(403).json({ error: `Access restricted to ${role}s` });
    }
    next();
  };
}

module.exports = { authenticate, requireRole };
