const pool = require('../config/db');

/**
 * Helper to validate positive integer IDs
 */
const isValidPositiveInteger = (val) => {
  if (val === undefined || val === null || val === '') return false;
  const num = Number(val);
  return Number.isInteger(num) && num > 0;
};

/**
 * POST /api/students/enroll
 * Admin only: Enroll an approved admission application into a section
 * Multi-step transactional operation with concurrency locking and 4 quarterly installments
 */
const enrollStudent = async (req, res, next) => {
  const { application_id, section_id, fee_structure_id } = req.body;

  // 1. Validate request body IDs
  if (
    !isValidPositiveInteger(application_id) ||
    !isValidPositiveInteger(section_id) ||
    !isValidPositiveInteger(fee_structure_id)
  ) {
    return res.status(400).json({
      success: false,
      message: 'application_id, section_id, and fee_structure_id must be valid positive integers'
    });
  }

  const appId = parseInt(application_id, 10);
  const secId = parseInt(section_id, 10);
  const feeId = parseInt(fee_structure_id, 10);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 2. Lock admission application row to prevent concurrent decisions/enrollments
    const appLockRes = await client.query(
      `SELECT 
         id, 
         student_first_name, 
         student_last_name, 
         date_of_birth, 
         target_class_id, 
         status
       FROM admission_applications 
       WHERE id = $1 
       FOR UPDATE`,
      [appId]
    );

    if (appLockRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Admission application not found'
      });
    }

    const application = appLockRes.rows[0];

    // 3. Verify application status is APPROVED
    if (application.status !== 'APPROVED') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: `Cannot enroll application: application status is ${application.status}. Only APPROVED applications can be enrolled.`
      });
    }

    // 4. Verify application has not already been enrolled
    const studentCheckRes = await client.query(
      'SELECT id FROM students WHERE application_id = $1',
      [appId]
    );

    if (studentCheckRes.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: `Application ${appId} has already been enrolled as student ID ${studentCheckRes.rows[0].id}`
      });
    }

    // 5. Lock section row to prevent concurrent capacity oversubscription
    const secLockRes = await client.query(
      `SELECT 
         s.id, 
         s.class_id, 
         s.name, 
         s.capacity, 
         c.name AS class_name
       FROM sections s
       JOIN classes c ON s.class_id = c.id
       WHERE s.id = $1 
       FOR UPDATE`,
      [secId]
    );

    if (secLockRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Section not found'
      });
    }

    const section = secLockRes.rows[0];

    // 6. Validate section belongs to the same class as application's target_class_id
    if (section.class_id !== application.target_class_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `Selected section belongs to class ID ${section.class_id} (${section.class_name}), but application target class is ID ${application.target_class_id}`
      });
    }

    // 7. Validate section capacity under section lock
    const countRes = await client.query(
      'SELECT COUNT(*)::int AS enrolled_count FROM students WHERE section_id = $1',
      [secId]
    );
    const enrolledCount = countRes.rows[0].enrolled_count;

    if (enrolledCount >= section.capacity) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: `Section ${section.name} of ${section.class_name} is already at full capacity (${enrolledCount}/${section.capacity})`
      });
    }

    // 8. Lock and validate fee structure
    const feeLockRes = await client.query(
      `SELECT 
         fs.id, 
         fs.class_id, 
         fs.academic_year, 
         fs.annual_fee,
         c.name AS class_name
       FROM fee_structures fs
       JOIN classes c ON fs.class_id = c.id
       WHERE fs.id = $1 
       FOR UPDATE`,
      [feeId]
    );

    if (feeLockRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Fee structure not found'
      });
    }

    const feeStructure = feeLockRes.rows[0];

    // 9. Validate fee structure belongs to the application's target class
    if (feeStructure.class_id !== application.target_class_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `Selected fee structure belongs to class ID ${feeStructure.class_id} (${feeStructure.class_name}), but application target class is ID ${application.target_class_id}`
      });
    }

    // 10. Validate annual fee is positive
    const annualFeeNum = Number(feeStructure.annual_fee);
    if (isNaN(annualFeeNum) || annualFeeNum <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Fee structure annual fee must be greater than zero'
      });
    }

    // 11. Create student record
    const studentInsertRes = await client.query(
      `INSERT INTO students (
         application_id, 
         first_name, 
         last_name, 
         date_of_birth, 
         section_id
       ) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, application_id, first_name, last_name, date_of_birth, section_id, enrolled_at`,
      [
        appId,
        application.student_first_name,
        application.student_last_name,
        application.date_of_birth,
        secId
      ]
    );

    const newStudent = studentInsertRes.rows[0];

    // 12. Generate exactly four quarterly fee installments
    // Prevent float rounding issues by converting to minor units (cents/paise)
    const totalCents = Math.round(annualFeeNum * 100);
    const baseCents = Math.floor(totalCents / 4);
    const remainderCents = totalCents % 4;

    // Derive base year from academic_year (e.g., '2023-2024' -> 2023)
    const startYear = parseInt(feeStructure.academic_year.split('-')[0], 10) || new Date().getFullYear();

    const createdInstallments = [];
    for (let i = 1; i <= 4; i++) {
      // Deterministically distribute remainder minor units across early installments
      const extraCent = i <= remainderCents ? 1 : 0;
      const installmentAmount = ((baseCents + extraCent) / 100).toFixed(2);

      // Quarterly schedule: May 1, July 1, September 1, November 1
      const dueMonth = 3 + i * 2;
      const dueDate = `${startYear}-${String(dueMonth).padStart(2, '0')}-01`;

      const instInsertRes = await client.query(
        `INSERT INTO fee_installments (
           student_id, 
           fee_structure_id, 
           installment_number, 
           amount, 
           status, 
           due_date
         ) 
         VALUES ($1, $2, $3, $4, 'PENDING', $5) 
         RETURNING id, installment_number, amount, status, due_date`,
        [newStudent.id, feeId, i, installmentAmount, dueDate]
      );

      createdInstallments.push(instInsertRes.rows[0]);
    }

    // 13. Commit transaction
    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: 'Student enrolled successfully',
      data: {
        student: {
          id: newStudent.id,
          application_id: newStudent.application_id,
          first_name: newStudent.first_name,
          last_name: newStudent.last_name,
          date_of_birth: newStudent.date_of_birth,
          section_id: newStudent.section_id,
          section_name: section.name,
          class_id: section.class_id,
          class_name: section.class_name,
          enrolled_at: newStudent.enrolled_at
        },
        fee_structure: {
          id: feeStructure.id,
          academic_year: feeStructure.academic_year,
          annual_fee: feeStructure.annual_fee
        },
        installments: createdInstallments
      }
    });

  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rbError) {
      console.error('Rollback error:', rbError.message);
    }

    // Handle duplicate enrollment unique constraint cleanly
    if (error.code === '23505' && error.constraint === 'students_application_id_key') {
      return res.status(409).json({
        success: false,
        message: 'Application has already been enrolled'
      });
    }

    next(error);
  } finally {
    client.release();
  }
};

/**
 * GET /api/students
 * Admin only: List enrolled students with class, section, and academic year
 * Uses LATERAL join to prevent row multiplication from multiple installments
 */
const getStudents = async (req, res, next) => {
  try {
    const { class_id, section_id } = req.query;
    const queryParams = [];
    const whereClauses = [];

    if (class_id !== undefined) {
      if (!isValidPositiveInteger(class_id)) {
        return res.status(400).json({
          success: false,
          message: 'class_id filter must be a valid positive integer'
        });
      }
      queryParams.push(parseInt(class_id, 10));
      whereClauses.push(`c.id = $${queryParams.length}`);
    }

    if (section_id !== undefined) {
      if (!isValidPositiveInteger(section_id)) {
        return res.status(400).json({
          success: false,
          message: 'section_id filter must be a valid positive integer'
        });
      }
      queryParams.push(parseInt(section_id, 10));
      whereClauses.push(`sec.id = $${queryParams.length}`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const query = `
      SELECT 
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
        c.level AS class_level,
        fs.academic_year
      FROM students s
      JOIN sections sec ON s.section_id = sec.id
      JOIN classes c ON sec.class_id = c.id
      LEFT JOIN LATERAL (
        SELECT fs_inner.academic_year
        FROM fee_installments fi
        JOIN fee_structures fs_inner ON fi.fee_structure_id = fs_inner.id
        WHERE fi.student_id = s.id
        LIMIT 1
      ) fs ON true
      ${whereSql}
      ORDER BY s.id ASC;
    `;

    const result = await pool.query(query, queryParams);

    return res.status(200).json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/students/:id
 * Admin only: Retrieve single student profile with class, section, fee structure, and 4 installments
 */
const getStudentById = async (req, res, next) => {
  try {
    const studentIdParam = req.params.id;
    if (!isValidPositiveInteger(studentIdParam)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid student ID'
      });
    }

    const studentId = parseInt(studentIdParam, 10);

    const studentQuery = `
      SELECT 
        s.id,
        s.application_id,
        s.first_name,
        s.last_name,
        s.date_of_birth,
        s.enrolled_at,
        sec.id AS section_id,
        sec.name AS section_name,
        sec.capacity AS section_capacity,
        c.id AS class_id,
        c.name AS class_name,
        c.level AS class_level,
        app.parent_name,
        app.parent_email,
        app.parent_phone
      FROM students s
      JOIN sections sec ON s.section_id = sec.id
      JOIN classes c ON sec.class_id = c.id
      JOIN admission_applications app ON s.application_id = app.id
      WHERE s.id = $1;
    `;

    const studentRes = await pool.query(studentQuery, [studentId]);

    if (studentRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    const student = studentRes.rows[0];

    // Fetch installments and fee structure
    const installmentsQuery = `
      SELECT 
        fi.id,
        fi.installment_number,
        fi.amount,
        fi.status,
        fi.due_date,
        fs.id AS fee_structure_id,
        fs.academic_year,
        fs.annual_fee
      FROM fee_installments fi
      JOIN fee_structures fs ON fi.fee_structure_id = fs.id
      WHERE fi.student_id = $1
      ORDER BY fi.installment_number ASC;
    `;

    const instRes = await pool.query(installmentsQuery, [studentId]);

    let feeStructureInfo = null;
    if (instRes.rows.length > 0) {
      const first = instRes.rows[0];
      feeStructureInfo = {
        id: first.fee_structure_id,
        academic_year: first.academic_year,
        annual_fee: first.annual_fee
      };
    }

    const installments = instRes.rows.map((row) => ({
      id: row.id,
      installment_number: row.installment_number,
      amount: row.amount,
      status: row.status,
      due_date: row.due_date
    }));

    return res.status(200).json({
      success: true,
      data: {
        id: student.id,
        application_id: student.application_id,
        first_name: student.first_name,
        last_name: student.last_name,
        date_of_birth: student.date_of_birth,
        enrolled_at: student.enrolled_at,
        parent_name: student.parent_name,
        parent_email: student.parent_email,
        parent_phone: student.parent_phone,
        class: {
          id: student.class_id,
          name: student.class_name,
          level: student.class_level
        },
        section: {
          id: student.section_id,
          name: student.section_name,
          capacity: student.section_capacity
        },
        fee_structure: feeStructureInfo,
        installments
      }
    });

  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/students/:id/fees
 * Admin only: Retrieve student's fee structure, 4 installments, and payment details for paid installments
 */
const getStudentFees = async (req, res, next) => {
  try {
    const studentIdParam = req.params.id;
    if (!isValidPositiveInteger(studentIdParam)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid student ID'
      });
    }

    const studentId = parseInt(studentIdParam, 10);

    const studentQuery = `
      SELECT 
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
      WHERE s.id = $1;
    `;

    const studentRes = await pool.query(studentQuery, [studentId]);

    if (studentRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    const student = studentRes.rows[0];

    const feesQuery = `
      SELECT 
        fi.id AS installment_id,
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
        p.reference_number,
        p.payment_date,
        p.remarks
      FROM fee_installments fi
      JOIN fee_structures fs ON fi.fee_structure_id = fs.id
      LEFT JOIN payments p ON p.installment_id = fi.id
      WHERE fi.student_id = $1
      ORDER BY fi.installment_number ASC;
    `;

    const feesRes = await pool.query(feesQuery, [studentId]);

    let feeStructureInfo = null;
    if (feesRes.rows.length > 0) {
      const first = feesRes.rows[0];
      feeStructureInfo = {
        id: first.fee_structure_id,
        academic_year: first.academic_year,
        annual_fee: first.annual_fee
      };
    }

    let totalPaid = 0;
    let totalPending = 0;

    const installments = feesRes.rows.map((row) => {
      const amt = Number(row.amount);
      if (row.status === 'PAID') {
        totalPaid += amt;
      } else {
        totalPending += amt;
      }

      let paymentInfo = null;
      if (row.payment_id) {
        paymentInfo = {
          id: row.payment_id,
          receipt_number: row.receipt_number,
          amount_paid: row.amount_paid,
          payment_method: row.payment_method,
          reference_number: row.reference_number,
          payment_date: row.payment_date,
          remarks: row.remarks
        };
      }

      return {
        id: row.installment_id,
        installment_number: row.installment_number,
        amount: row.amount,
        status: row.status,
        due_date: row.due_date,
        payment: paymentInfo
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        student: {
          id: student.id,
          application_id: student.application_id,
          name: `${student.first_name} ${student.last_name}`,
          first_name: student.first_name,
          last_name: student.last_name,
          date_of_birth: student.date_of_birth,
          enrolled_at: student.enrolled_at,
          class: {
            id: student.class_id,
            name: student.class_name,
            level: student.class_level
          },
          section: {
            id: student.section_id,
            name: student.section_name
          }
        },
        fee_structure: feeStructureInfo,
        summary: {
          annual_fee: feeStructureInfo ? feeStructureInfo.annual_fee : '0.00',
          total_paid: totalPaid.toFixed(2),
          total_pending: totalPending.toFixed(2)
        },
        installments
      }
    });

  } catch (error) {
    next(error);
  }
};

module.exports = {
  enrollStudent,
  getStudents,
  getStudentById,
  getStudentFees
};
