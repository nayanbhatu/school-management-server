const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

/**
 * POST /api/auth/login
 * Authenticates user credentials and returns signed JWT with safe user data
 */
const login = async (req, res, next) => {
  try {
    const { username, password } = req.body;

    // Validate request body
    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required'
      });
    }

    const trimmedUsername = username.trim();

    // Query user by username or teacher email using parameterized SQL
    const userQuery = `
      SELECT 
        u.id, 
        u.username, 
        u.password_hash, 
        u.role, 
        u.created_at,
        t.id AS teacher_id, 
        t.first_name, 
        t.last_name, 
        t.email, 
        t.is_active AS teacher_is_active
      FROM users u
      LEFT JOIN teachers t ON t.user_id = u.id
      WHERE u.username = $1 OR (t.email IS NOT NULL AND t.email = $1)
      LIMIT 1
    `;

    const result = await pool.query(userQuery, [trimmedUsername]);

    if (result.rows.length === 0) {
      // Reject invalid credentials with a generic message
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    const user = result.rows[0];

    // Verify password hash
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Reject inactive users
    if (user.role === 'teacher' && user.teacher_is_active === false) {
      return res.status(403).json({
        success: false,
        message: 'User account is inactive. Please contact the administrator.'
      });
    }

    if (!process.env.JWT_SECRET) {
      console.error('FATAL: JWT_SECRET environment variable is not defined.');
      return res.status(500).json({
        success: false,
        message: 'Internal server configuration error'
      });
    }

    // Sign JWT
    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Prepare safe user object (strictly omit password_hash)
    const safeUser = {
      id: user.id,
      username: user.username,
      role: user.role,
      ...(user.teacher_id && {
        teacher_id: user.teacher_id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        is_active: user.teacher_is_active
      })
    };

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: safeUser
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/auth/me
 * Returns the currently authenticated user's profile
 */
const getMe = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const userQuery = `
      SELECT 
        u.id, 
        u.username, 
        u.role, 
        u.created_at,
        t.id AS teacher_id, 
        t.first_name, 
        t.last_name, 
        t.email, 
        t.is_active AS teacher_is_active
      FROM users u
      LEFT JOIN teachers t ON t.user_id = u.id
      WHERE u.id = $1
      LIMIT 1
    `;

    const result = await pool.query(userQuery, [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = result.rows[0];

    // Reject inactive users
    if (user.role === 'teacher' && user.teacher_is_active === false) {
      return res.status(403).json({
        success: false,
        message: 'User account is inactive. Please contact the administrator.'
      });
    }

    const safeUser = {
      id: user.id,
      username: user.username,
      role: user.role,
      created_at: user.created_at,
      ...(user.teacher_id && {
        teacher_id: user.teacher_id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        is_active: user.teacher_is_active
      })
    };

    return res.status(200).json({
      success: true,
      user: safeUser
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  login,
  getMe
};
