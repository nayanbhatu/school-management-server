const pool = require('../config/db');

/**
 * GET /api/subjects
 * List all active subjects ordered by name
 */
const getSubjects = async (req, res, next) => {
  try {
    const query = 'SELECT id, name FROM subjects ORDER BY name ASC';
    const result = await pool.query(query);

    return res.status(200).json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/subjects
 * Admin only: Create a new subject
 */
const createSubject = async (req, res, next) => {
  try {
    const { name } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Subject name is required'
      });
    }

    const trimmedName = name.trim();
    if (trimmedName.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Subject name must not exceed 100 characters'
      });
    }

    // Check for duplicate subject name (case-insensitive)
    const existingCheck = await pool.query(
      'SELECT id, name FROM subjects WHERE LOWER(name) = LOWER($1)',
      [trimmedName]
    );

    if (existingCheck.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Subject with this name already exists'
      });
    }

    const insertQuery = 'INSERT INTO subjects (name) VALUES ($1) RETURNING id, name';
    const result = await pool.query(insertQuery, [trimmedName]);

    return res.status(201).json({
      success: true,
      message: 'Subject created successfully',
      data: result.rows[0]
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'Subject with this name already exists'
      });
    }
    next(error);
  }
};

module.exports = {
  getSubjects,
  createSubject
};
