const pool = require('../config/db');
const emailService = require('../services/email.service');
const {
  validateEmail,
  isValidEmail,
  validateIndianPhoneNumber,
  isValidPastDate,
  isValidPositiveInteger
} = require('../utils/validators');

/**
 * POST /api/admissions
 * Admin only: Create a new admission application
 */
const createAdmission = async (req, res, next) => {
  try {
    const {
      student_first_name,
      student_last_name,
      date_of_birth,
      target_class_id,
      parent_name,
      parent_email,
      parent_phone
    } = req.body;

    // 1. Validate required text fields
    if (
      !student_first_name || typeof student_first_name !== 'string' || !student_first_name.trim() ||
      !student_last_name || typeof student_last_name !== 'string' || !student_last_name.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: 'Student first name and last name are required'
      });
    }

    const cleanFirstName = student_first_name.trim();
    const cleanLastName = student_last_name.trim();

    if (cleanFirstName.length > 100 || cleanLastName.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Student first name and last name must not exceed 100 characters'
      });
    }

    if (!parent_name || typeof parent_name !== 'string' || !parent_name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Parent name is required'
      });
    }

    const cleanParentName = parent_name.trim();
    if (cleanParentName.length > 150) {
      return res.status(400).json({
        success: false,
        message: 'Parent name must not exceed 150 characters'
      });
    }

    // 2. Validate Indian mobile phone number
    if (!parent_phone || typeof parent_phone !== 'string' || !parent_phone.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Parent phone number is required'
      });
    }

    const phoneValidation = validateIndianPhoneNumber(parent_phone);
    if (!phoneValidation.isValid) {
      return res.status(400).json({
        success: false,
        message: phoneValidation.message || 'Invalid Indian mobile number'
      });
    }
    const cleanParentPhone = phoneValidation.normalized;

    // 3. Validate email format
    if (!parent_email || typeof parent_email !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'A valid parent email address is required'
      });
    }

    const emailValidation = validateEmail(parent_email);
    if (!emailValidation.isValid) {
      return res.status(400).json({
        success: false,
        message: emailValidation.message || 'A valid parent email address is required (e.g. parent@example.com)'
      });
    }
    const cleanParentEmail = emailValidation.normalized;

    // 4. Validate date of birth (must be valid past date YYYY-MM-DD)
    const dobValidation = isValidPastDate(date_of_birth);
    if (!dobValidation.isValid) {
      return res.status(400).json({
        success: false,
        message: dobValidation.message || 'Date of birth must be a valid past date'
      });
    }

    // 5. Validate target class
    if (!isValidPositiveInteger(target_class_id)) {
      return res.status(400).json({
        success: false,
        message: 'target_class_id must be a valid positive integer'
      });
    }
    const classId = parseInt(target_class_id, 10);

    const classCheck = await pool.query('SELECT id, name FROM classes WHERE id = $1', [classId]);
    if (classCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Target class not found'
      });
    }

    // 6. Insert new application with forced initial status 'PENDING'
    const insertQuery = `
      INSERT INTO admission_applications (
        student_first_name,
        student_last_name,
        date_of_birth,
        target_class_id,
        parent_name,
        parent_email,
        parent_phone,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING')
      RETURNING id, student_first_name, student_last_name, date_of_birth,
                target_class_id, parent_name, parent_email, parent_phone,
                status, applied_at;
    `;

    const result = await pool.query(insertQuery, [
      cleanFirstName,
      cleanLastName,
      date_of_birth,
      classId,
      cleanParentName,
      cleanParentEmail,
      cleanParentPhone
    ]);

    return res.status(201).json({
      success: true,
      message: 'Admission application created successfully',
      data: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admissions
 * Admin only: List all admission applications, optionally filtered by status
 */
const getAdmissions = async (req, res, next) => {
  try {
    const { status } = req.query;
    let normalizedStatus = null;

    if (status !== undefined) {
      if (typeof status !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'Status filter must be a string'
        });
      }
      normalizedStatus = status.trim().toUpperCase();
      const validStatuses = ['PENDING', 'APPROVED', 'REJECTED'];
      if (!validStatuses.includes(normalizedStatus)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid status filter. Allowed values: PENDING, APPROVED, REJECTED'
        });
      }
    }

    const query = `
      SELECT 
        a.id,
        a.student_first_name,
        a.student_last_name,
        a.date_of_birth,
        a.target_class_id,
        c.name AS target_class_name,
        c.level AS target_class_level,
        a.parent_name,
        a.parent_email,
        a.parent_phone,
        a.status,
        a.applied_at
      FROM admission_applications a
      JOIN classes c ON a.target_class_id = c.id
      WHERE ($1::varchar IS NULL OR a.status = $1)
      ORDER BY a.applied_at DESC, a.id DESC;
    `;

    const result = await pool.query(query, [normalizedStatus]);

    return res.status(200).json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admissions/:id
 * Admin only: Get details of a single admission application
 */
const getAdmissionById = async (req, res, next) => {
  try {
    const admissionId = parseInt(req.params.id, 10);

    if (isNaN(admissionId) || admissionId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid admission ID'
      });
    }

    const query = `
      SELECT 
        a.id,
        a.student_first_name,
        a.student_last_name,
        a.date_of_birth,
        a.target_class_id,
        c.name AS target_class_name,
        c.level AS target_class_level,
        a.parent_name,
        a.parent_email,
        a.parent_phone,
        a.status,
        a.applied_at
      FROM admission_applications a
      JOIN classes c ON a.target_class_id = c.id
      WHERE a.id = $1;
    `;

    const result = await pool.query(query, [admissionId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Admission application not found'
      });
    }

    return res.status(200).json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/admissions/:id/status
 * Admin only: Approve or reject an admission application
 * Uses transaction with SELECT ... FOR UPDATE to prevent concurrency double-decisions
 */
const updateAdmissionStatus = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const admissionId = parseInt(req.params.id, 10);

    if (isNaN(admissionId) || admissionId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid admission ID'
      });
    }

    const { status } = req.body;
    if (!status || typeof status !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Status decision is required'
      });
    }

    const normalizedStatus = status.trim().toUpperCase();
    if (!['APPROVED', 'REJECTED'].includes(normalizedStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status decision. Allowed decisions: APPROVED, REJECTED'
      });
    }

    // Begin transaction for concurrency-safe status transition
    await client.query('BEGIN');

    // Exclusively lock the application row
    const lockQuery = `
      SELECT 
        id,
        student_first_name,
        student_last_name,
        target_class_id,
        parent_name,
        parent_email,
        parent_phone,
        status
      FROM admission_applications
      WHERE id = $1
      FOR UPDATE;
    `;
    const lockResult = await client.query(lockQuery, [admissionId]);

    if (lockResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Admission application not found'
      });
    }

    const existingApp = lockResult.rows[0];

    // Enforce valid transition: only PENDING can transition to APPROVED or REJECTED
    if (existingApp.status !== 'PENDING') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: `Cannot update application status: application is already ${existingApp.status}. Only PENDING applications can be decided.`
      });
    }

    // Update status
    const updateQuery = `
      UPDATE admission_applications
      SET status = $1
      WHERE id = $2
      RETURNING id, student_first_name, student_last_name, target_class_id,
                parent_name, parent_email, parent_phone, status, applied_at;
    `;
    const updateResult = await client.query(updateQuery, [normalizedStatus, admissionId]);

    // Commit database transaction before any external side effects
    await client.query('COMMIT');

    // Fetch class name for notification
    let targetClassName = null;
    if (existingApp.target_class_id) {
      const clsRes = await pool.query('SELECT name FROM classes WHERE id = $1', [existingApp.target_class_id]);
      if (clsRes.rows.length > 0) {
        targetClassName = clsRes.rows[0].name;
      }
    }

    // Trigger email notification AFTER successful commit
    const studentFullName = `${existingApp.student_first_name} ${existingApp.student_last_name}`.trim();
    const emailResult = await emailService.sendDecisionEmail({
      recipientEmail: existingApp.parent_email,
      recipientName: existingApp.parent_name,
      studentName: studentFullName,
      status: normalizedStatus,
      targetClassName
    });

    return res.status(200).json({
      success: true,
      message: `Admission application ${normalizedStatus.toLowerCase()} successfully`,
      data: updateResult.rows[0],
      notification: emailResult
    });

  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rbError) {
      console.error('Rollback error:', rbError.message);
    }
    next(error);
  } finally {
    client.release();
  }
};

module.exports = {
  createAdmission,
  getAdmissions,
  getAdmissionById,
  updateAdmissionStatus
};
