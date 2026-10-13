const bcrypt = require('bcrypt');
const pool = require('../config/db');
const { validateEmail, isValidEmail } = require('../utils/validators');

/**
 * Helper to validate positive integer IDs
 */
const isValidPositiveInteger = (val) => {
  if (val === undefined || val === null || val === '') return false;
  const num = Number(val);
  return Number.isInteger(num) && num > 0;
};

/**
 * GET /api/teachers
 * List all teachers with their account username and active status
 */
const getTeachers = async (req, res, next) => {
  try {
    const query = `
      SELECT 
        t.id, 
        t.user_id, 
        t.first_name, 
        t.last_name, 
        t.email, 
        t.is_active, 
        t.created_at,
        u.username
      FROM teachers t
      JOIN users u ON t.user_id = u.id
      ORDER BY t.first_name ASC, t.last_name ASC;
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
 * GET /api/teachers/:id
 * Retrieve a specific teacher profile with joined assignments
 */
const getTeacherById = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isValidPositiveInteger(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid teacher ID'
      });
    }

    const teacherId = parseInt(id, 10);

    const teacherQuery = `
      SELECT 
        t.id, 
        t.user_id, 
        t.first_name, 
        t.last_name, 
        t.email, 
        t.is_active, 
        t.created_at,
        u.username
      FROM teachers t
      JOIN users u ON t.user_id = u.id
      WHERE t.id = $1;
    `;
    const teacherRes = await pool.query(teacherQuery, [teacherId]);

    if (teacherRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Teacher not found'
      });
    }

    const teacher = teacherRes.rows[0];

    const assignQuery = `
      SELECT 
        ta.id AS assignment_id,
        ta.section_id,
        sec.name AS section_name,
        c.id AS class_id,
        c.name AS class_name,
        c.level AS class_level,
        sub.id AS subject_id,
        sub.name AS subject_name
      FROM teacher_assignments ta
      JOIN sections sec ON ta.section_id = sec.id
      JOIN classes c ON sec.class_id = c.id
      JOIN subjects sub ON ta.subject_id = sub.id
      WHERE ta.teacher_id = $1
      ORDER BY c.level ASC, sec.name ASC, sub.name ASC;
    `;
    const assignRes = await pool.query(assignQuery, [teacherId]);

    return res.status(200).json({
      success: true,
      data: {
        ...teacher,
        assignments: assignRes.rows
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/teachers
 * Admin only: Create a teacher record and its associated login user account atomically
 */
const createTeacher = async (req, res, next) => {
  const { username, password, first_name, last_name, email } = req.body;

  // 1. Validate username
  if (
    !username ||
    typeof username !== 'string' ||
    username.trim().length < 3 ||
    username.trim().length > 50 ||
    !/^[a-zA-Z0-9_]+$/.test(username.trim())
  ) {
    return res.status(400).json({
      success: false,
      message: 'username is required and must be 3-50 alphanumeric characters or underscores'
    });
  }
  const cleanUsername = username.trim();

  // 2. Validate password
  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({
      success: false,
      message: 'password is required and must be at least 6 characters'
    });
  }

  // 3. Validate first_name & last_name
  if (!first_name || typeof first_name !== 'string' || !first_name.trim() || first_name.trim().length > 100) {
    return res.status(400).json({
      success: false,
      message: 'first_name is required (up to 100 characters)'
    });
  }
  const cleanFirstName = first_name.trim();

  if (!last_name || typeof last_name !== 'string' || !last_name.trim() || last_name.trim().length > 100) {
    return res.status(400).json({
      success: false,
      message: 'last_name is required (up to 100 characters)'
    });
  }
  const cleanLastName = last_name.trim();

  // 4. Validate email
  const emailValidation = validateEmail(email);
  if (!emailValidation.isValid) {
    return res.status(400).json({
      success: false,
      message: emailValidation.message || 'A valid email address is required (up to 150 characters)'
    });
  }
  const cleanEmail = emailValidation.normalized;

  // 5. Pre-check duplicate username or email
  const userDupCheck = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [cleanUsername]);
  if (userDupCheck.rows.length > 0) {
    return res.status(409).json({
      success: false,
      message: 'Username is already taken'
    });
  }

  const teacherDupCheck = await pool.query('SELECT id FROM teachers WHERE LOWER(email) = LOWER($1)', [cleanEmail]);
  if (teacherDupCheck.rows.length > 0) {
    return res.status(409).json({
      success: false,
      message: 'Email is already in use by another teacher'
    });
  }

  // 6. Hash password with bcrypt (10 rounds)
  const passwordHash = await bcrypt.hash(password, 10);

  // 7. Atomic transaction for user + teacher records
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userInsertQuery = `
      INSERT INTO users (username, password_hash, role)
      VALUES ($1, $2, 'teacher')
      RETURNING id, username, role, created_at;
    `;
    const userRes = await client.query(userInsertQuery, [cleanUsername, passwordHash]);
    const newUser = userRes.rows[0];

    const teacherInsertQuery = `
      INSERT INTO teachers (user_id, first_name, last_name, email, is_active)
      VALUES ($1, $2, $3, $4, true)
      RETURNING id, user_id, first_name, last_name, email, is_active, created_at;
    `;
    const teacherRes = await client.query(teacherInsertQuery, [
      newUser.id,
      cleanFirstName,
      cleanLastName,
      cleanEmail
    ]);
    const newTeacher = teacherRes.rows[0];

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: 'Teacher account created successfully',
      data: {
        id: newTeacher.id,
        user_id: newTeacher.user_id,
        username: newUser.username,
        first_name: newTeacher.first_name,
        last_name: newTeacher.last_name,
        email: newTeacher.email,
        role: newUser.role,
        is_active: newTeacher.is_active,
        created_at: newTeacher.created_at
      }
    });

  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rbErr) {
      console.error('Rollback error:', rbErr.message);
    }

    if (error.code === '23505') {
      if (error.constraint === 'users_username_key') {
        return res.status(409).json({
          success: false,
          message: 'Username is already taken'
        });
      }
      if (error.constraint === 'teachers_email_key') {
        return res.status(409).json({
          success: false,
          message: 'Email is already in use by another teacher'
        });
      }
    }
    next(error);
  } finally {
    client.release();
  }
};

/**
 * PATCH /api/teachers/:id/status
 * PUT /api/teachers/:id/status
 * Admin only: Activate or deactivate a teacher account
 */
const updateTeacherStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isValidPositiveInteger(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid teacher ID'
      });
    }
    const teacherId = parseInt(id, 10);

    const { is_active } = req.body;
    if (typeof is_active !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'is_active must be a boolean (true or false)'
      });
    }

    const checkTeacher = await pool.query('SELECT id, user_id, first_name, last_name, email, is_active FROM teachers WHERE id = $1', [teacherId]);
    if (checkTeacher.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Teacher not found'
      });
    }

    const updateQuery = `
      UPDATE teachers
      SET is_active = $1
      WHERE id = $2
      RETURNING id, user_id, first_name, last_name, email, is_active;
    `;
    const updateRes = await pool.query(updateQuery, [is_active, teacherId]);
    const updated = updateRes.rows[0];

    return res.status(200).json({
      success: true,
      message: `Teacher account ${is_active ? 'activated' : 'deactivated'} successfully`,
      data: updated
    });

  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/teachers/:id/reset-password
 * POST /api/teachers/:id/reset-password
 * Admin only: Reset credentials/password for an existing teacher account
 */
const resetTeacherPassword = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isValidPositiveInteger(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid teacher ID'
      });
    }
    const teacherId = parseInt(id, 10);

    const { password } = req.body || {};

    let newPassword = '';
    if (password !== undefined && password !== null && password !== '') {
      if (typeof password !== 'string' || password.length < 6 || password.length > 100) {
        return res.status(400).json({
          success: false,
          message: 'Password must be a string containing at least 6 characters (up to 100 characters)'
        });
      }
      newPassword = password;
    } else {
      // Generate secure 12-char alphanumeric temporary password
      const crypto = require('crypto');
      newPassword = 'Tch@' + crypto.randomBytes(4).toString('hex');
    }

    // Check teacher existence and fetch linked user_id
    const teacherRes = await pool.query(
      `SELECT t.id, t.user_id, t.first_name, t.last_name, t.email, u.username
       FROM teachers t
       JOIN users u ON t.user_id = u.id
       WHERE t.id = $1`,
      [teacherId]
    );

    if (teacherRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Teacher not found'
      });
    }

    const teacher = teacherRes.rows[0];

    // Hash new password with bcrypt (10 rounds)
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // Update user password_hash
    await pool.query(
      `UPDATE users
       SET password_hash = $1
       WHERE id = $2`,
      [passwordHash, teacher.user_id]
    );

    return res.status(200).json({
      success: true,
      message: `Password reset successfully for teacher ${teacher.first_name} ${teacher.last_name}`,
      data: {
        teacher_id: teacher.id,
        username: teacher.username,
        first_name: teacher.first_name,
        last_name: teacher.last_name,
        email: teacher.email,
        temporary_password: newPassword
      }
    });

  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/teacher/students
 * Authenticated Teachers only: Retrieve student roster and fee installment/payment status for assigned sections
 * Teacher identity is strictly derived from req.user.id (never accepted via params/body/query)
 */
const getTeacherStudents = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // 1. Fetch teacher record associated with authenticated user
    const teacherQuery = `
      SELECT id, first_name, last_name, email, is_active
      FROM teachers
      WHERE user_id = $1;
    `;
    const teacherRes = await pool.query(teacherQuery, [userId]);

    if (teacherRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Teacher profile not found'
      });
    }

    const teacher = teacherRes.rows[0];

    if (!teacher.is_active) {
      return res.status(403).json({
        success: false,
        message: 'User account is inactive. Please contact the administrator.'
      });
    }

    // 2. Retrieve sections assigned to this teacher
    const assignQuery = `
      SELECT DISTINCT section_id
      FROM teacher_assignments
      WHERE teacher_id = $1;
    `;
    const assignRes = await pool.query(assignQuery, [teacher.id]);

    if (assignRes.rows.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        data: []
      });
    }

    const assignedSectionIds = assignRes.rows.map((r) => r.section_id);

    // 3. Retrieve students in assigned sections (distinct to avoid duplicates if teacher has multiple subjects in section)
    const studentsQuery = `
      SELECT DISTINCT
        s.id,
        s.application_id,
        s.first_name,
        s.last_name,
        s.date_of_birth,
        s.enrolled_at,
        sec.id AS section_id,
        sec.name AS section_name,
        c.id AS class_id,
        c.name AS class_name,
        c.level AS class_level
      FROM students s
      JOIN sections sec ON s.section_id = sec.id
      JOIN classes c ON sec.class_id = c.id
      WHERE s.section_id = ANY($1)
      ORDER BY c.level ASC, sec.name ASC, s.last_name ASC, s.first_name ASC;
    `;
    const studentsRes = await pool.query(studentsQuery, [assignedSectionIds]);

    if (studentsRes.rows.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        data: []
      });
    }

    const studentIds = studentsRes.rows.map((s) => s.id);

    // 4. Retrieve fee installments and payment records for these students
    const feesQuery = `
      SELECT 
        fi.id AS installment_id,
        fi.student_id,
        fi.installment_number,
        fi.amount,
        fi.status,
        fi.due_date,
        fs.id AS fee_structure_id,
        fs.academic_year,
        fs.annual_fee,
        p.id AS payment_id,
        p.receipt_number,
        p.amount_paid,
        p.payment_method,
        p.payment_date
      FROM fee_installments fi
      JOIN fee_structures fs ON fi.fee_structure_id = fs.id
      LEFT JOIN LATERAL (
        SELECT id, receipt_number, amount_paid, payment_method, payment_date
        FROM payments
        WHERE installment_id = fi.id
        ORDER BY id DESC
        LIMIT 1
      ) p ON true
      WHERE fi.student_id = ANY($1)
      ORDER BY fi.student_id ASC, fi.installment_number ASC;
    `;
    const feesRes = await pool.query(feesQuery, [studentIds]);

    // Group installments by student_id
    const studentFeesMap = new Map();
    for (const row of feesRes.rows) {
      if (!studentFeesMap.has(row.student_id)) {
        studentFeesMap.set(row.student_id, {
          annual_fee: row.annual_fee,
          academic_year: row.academic_year,
          installments: []
        });
      }

      let paymentInfo = null;
      if (row.payment_id) {
        paymentInfo = {
          id: row.payment_id,
          receipt_number: row.receipt_number,
          amount_paid: row.amount_paid,
          payment_method: row.payment_method,
          payment_date: row.payment_date
        };
      }

      studentFeesMap.get(row.student_id).installments.push({
        id: row.installment_id,
        installment_number: row.installment_number,
        amount: row.amount,
        status: row.status,
        due_date: row.due_date,
        payment: paymentInfo
      });
    }

    // 5. Build enriched response
    const enrichedStudents = studentsRes.rows.map((student) => {
      const feeData = studentFeesMap.get(student.id) || {
        annual_fee: '0.00',
        academic_year: null,
        installments: []
      };

      let totalPaid = 0;
      let totalPending = 0;

      for (const inst of feeData.installments) {
        const amt = Number(inst.amount);
        if (inst.status === 'PAID') {
          totalPaid += amt;
        } else {
          totalPending += amt;
        }
      }

      const feePayload = {
        annual_fee: feeData.annual_fee,
        academic_year: feeData.academic_year,
        total_paid: totalPaid.toFixed(2),
        total_pending: totalPending.toFixed(2),
        installments: feeData.installments
      };

      return {
        id: student.id,
        application_id: student.application_id,
        first_name: student.first_name,
        last_name: student.last_name,
        name: `${student.first_name} ${student.last_name}`,
        date_of_birth: student.date_of_birth,
        enrolled_at: student.enrolled_at,
        class_id: student.class_id,
        class_name: student.class_name,
        class_level: student.class_level,
        section_id: student.section_id,
        section_name: student.section_name,
        class: {
          id: student.class_id,
          name: student.class_name,
          level: student.class_level
        },
        section: {
          id: student.section_id,
          name: student.section_name
        },
        fees: feePayload,
        fee_status: feePayload
      };
    });

    return res.status(200).json({
      success: true,
      count: enrichedStudents.length,
      data: enrichedStudents
    });

  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/teacher/assignments
 * Authenticated Teachers only: Retrieve assigned subjects, classes, and sections
 * Identity strictly derived from authenticated user's JWT (req.user.id)
 */
const getMyAssignments = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // 1. Fetch teacher record associated with authenticated user
    const teacherQuery = `
      SELECT id, first_name, last_name, email, is_active
      FROM teachers
      WHERE user_id = $1;
    `;
    const teacherRes = await pool.query(teacherQuery, [userId]);

    if (teacherRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Teacher profile not found'
      });
    }

    const teacher = teacherRes.rows[0];

    if (!teacher.is_active) {
      return res.status(403).json({
        success: false,
        message: 'User account is inactive. Please contact the administrator.'
      });
    }

    // 2. Fetch assignments joined with subject, section, class
    const assignQuery = `
      SELECT 
        ta.id AS assignment_id,
        ta.section_id,
        sec.name AS section_name,
        c.id AS class_id,
        c.name AS class_name,
        c.level AS class_level,
        sub.id AS subject_id,
        sub.name AS subject_name
      FROM teacher_assignments ta
      JOIN sections sec ON ta.section_id = sec.id
      JOIN classes c ON sec.class_id = c.id
      JOIN subjects sub ON ta.subject_id = sub.id
      WHERE ta.teacher_id = $1
      ORDER BY c.level ASC, sec.name ASC, sub.name ASC;
    `;
    const assignRes = await pool.query(assignQuery, [teacher.id]);

    return res.status(200).json({
      success: true,
      count: assignRes.rows.length,
      data: assignRes.rows
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getTeachers,
  getTeacherById,
  createTeacher,
  updateTeacherStatus,
  resetTeacherPassword,
  getTeacherStudents,
  getMyAssignments
};
