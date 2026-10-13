const pool = require('../config/db');

/**
 * GET /api/teacher-assignments
 * List all teacher assignments with teacher, subject, class, and section details
 */
const getTeacherAssignments = async (req, res, next) => {
  try {
    const query = `
      SELECT 
        ta.id,
        ta.teacher_id,
        t.first_name AS teacher_first_name,
        t.last_name AS teacher_last_name,
        t.email AS teacher_email,
        ta.subject_id,
        sub.name AS subject_name,
        ta.section_id,
        sec.name AS section_name,
        sec.class_id,
        c.name AS class_name,
        c.level AS class_level
      FROM teacher_assignments ta
      JOIN teachers t ON ta.teacher_id = t.id
      JOIN subjects sub ON ta.subject_id = sub.id
      JOIN sections sec ON ta.section_id = sec.id
      JOIN classes c ON sec.class_id = c.id
      ORDER BY c.level ASC, sec.name ASC, sub.name ASC
    `;
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
 * POST /api/teacher-assignments
 * Admin only: Assign an existing teacher, subject, and section
 */
const createTeacherAssignment = async (req, res, next) => {
  try {
    const { teacher_id, section_id, subject_id } = req.body;

    // Validate inputs
    const teacherId = parseInt(teacher_id, 10);
    const sectionId = parseInt(section_id, 10);
    const subjectId = parseInt(subject_id, 10);

    if (
      isNaN(teacherId) || teacherId <= 0 ||
      isNaN(sectionId) || sectionId <= 0 ||
      isNaN(subjectId) || subjectId <= 0
    ) {
      return res.status(400).json({
        success: false,
        message: 'teacher_id, section_id, and subject_id are required and must be valid positive integers'
      });
    }

    // Check teacher existence and active status
    const teacherCheck = await pool.query('SELECT id, is_active FROM teachers WHERE id = $1', [teacherId]);
    if (teacherCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Teacher not found'
      });
    }
    if (!teacherCheck.rows[0].is_active) {
      return res.status(400).json({
        success: false,
        message: 'Cannot assign an inactive teacher'
      });
    }

    // Check section existence
    const sectionCheck = await pool.query('SELECT id FROM sections WHERE id = $1', [sectionId]);
    if (sectionCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Section not found'
      });
    }

    // Check subject existence
    const subjectCheck = await pool.query('SELECT id FROM subjects WHERE id = $1', [subjectId]);
    if (subjectCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Subject not found'
      });
    }

    // Check duplicate assignment
    const duplicateCheck = await pool.query(
      'SELECT id FROM teacher_assignments WHERE teacher_id = $1 AND section_id = $2 AND subject_id = $3',
      [teacherId, sectionId, subjectId]
    );
    if (duplicateCheck.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'This teacher is already assigned to this subject in this section'
      });
    }

    // Insert assignment
    const insertQuery = `
      INSERT INTO teacher_assignments (teacher_id, section_id, subject_id)
      VALUES ($1, $2, $3)
      RETURNING id
    `;
    const insertResult = await pool.query(insertQuery, [teacherId, sectionId, subjectId]);
    const newAssignmentId = insertResult.rows[0].id;

    // Fetch enriched record details
    const enrichedQuery = `
      SELECT 
        ta.id,
        ta.teacher_id,
        t.first_name AS teacher_first_name,
        t.last_name AS teacher_last_name,
        t.email AS teacher_email,
        ta.subject_id,
        sub.name AS subject_name,
        ta.section_id,
        sec.name AS section_name,
        sec.class_id,
        c.name AS class_name,
        c.level AS class_level
      FROM teacher_assignments ta
      JOIN teachers t ON ta.teacher_id = t.id
      JOIN subjects sub ON ta.subject_id = sub.id
      JOIN sections sec ON ta.section_id = sec.id
      JOIN classes c ON sec.class_id = c.id
      WHERE ta.id = $1
    `;
    const enrichedResult = await pool.query(enrichedQuery, [newAssignmentId]);

    return res.status(201).json({
      success: true,
      message: 'Teacher assignment created successfully',
      data: enrichedResult.rows[0]
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'This teacher is already assigned to this subject in this section'
      });
    }
    next(error);
  }
};

/**
 * DELETE /api/teacher-assignments/:id
 * Admin only: Remove an existing teacher assignment
 */
const deleteTeacherAssignment = async (req, res, next) => {
  try {
    const assignmentId = parseInt(req.params.id, 10);

    if (isNaN(assignmentId) || assignmentId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid assignment ID'
      });
    }

    const deleteResult = await pool.query(
      'DELETE FROM teacher_assignments WHERE id = $1 RETURNING id',
      [assignmentId]
    );

    if (deleteResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Teacher assignment not found'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Teacher assignment removed successfully'
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getTeacherAssignments,
  createTeacherAssignment,
  deleteTeacherAssignment
};
