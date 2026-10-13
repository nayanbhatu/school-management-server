const pool = require('../config/db');

/**
 * GET /api/classes
 * List all classes ordered by level and name
 */
const getClasses = async (req, res, next) => {
  try {
    const query = 'SELECT id, name, level FROM classes ORDER BY level ASC, name ASC';
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
 * GET /api/classes/:id/sections
 * List sections for a specific class
 */
const getClassSections = async (req, res, next) => {
  try {
    const classId = parseInt(req.params.id, 10);

    if (isNaN(classId) || classId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid class ID'
      });
    }

    // Check if class exists
    const classCheck = await pool.query('SELECT id, name, level FROM classes WHERE id = $1', [classId]);
    if (classCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Class not found'
      });
    }

    // Retrieve sections for the class
    const sectionsQuery = `
      SELECT id, class_id, name, capacity 
      FROM sections 
      WHERE class_id = $1 
      ORDER BY name ASC
    `;
    const result = await pool.query(sectionsQuery, [classId]);

    return res.status(200).json({
      success: true,
      class: classCheck.rows[0],
      data: result.rows
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getClasses,
  getClassSections
};
