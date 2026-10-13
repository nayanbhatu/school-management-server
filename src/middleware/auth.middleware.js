const jwt = require('jsonwebtoken');
const pool = require('../config/db');

/**
 * Middleware to authenticate requests using JWT Bearer token
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Authorization token required'
    });
  }

  const token = authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Authorization token required'
    });
  }

  if (!process.env.JWT_SECRET) {
    console.error('FATAL: JWT_SECRET environment variable is not defined.');
    return res.status(500).json({
      success: false,
      message: 'Internal server authentication error'
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
    if (err) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }

    // Verify teacher active status
    if (decoded && decoded.role === 'teacher') {
      try {
        const teacherRes = await pool.query('SELECT is_active FROM teachers WHERE user_id = $1', [decoded.id]);
        if (teacherRes.rows.length > 0 && teacherRes.rows[0].is_active === false) {
          return res.status(403).json({
            success: false,
            message: 'User account is inactive. Please contact the administrator.'
          });
        }
      } catch (dbErr) {
        return next(dbErr);
      }
    }

    req.user = decoded;
    next();
  });
};

/**
 * Reusable role-authorization middleware
 * e.g., authorizeRoles('admin') or authorizeRoles('admin', 'teacher')
 */
const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const userRole = req.user.role.toLowerCase();
    const normalizedAllowed = allowedRoles.map(r => r.toLowerCase());

    if (!normalizedAllowed.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: 'Access forbidden: Insufficient permissions'
      });
    }

    next();
  };
};

module.exports = {
  authenticateToken,
  authorizeRoles
};
