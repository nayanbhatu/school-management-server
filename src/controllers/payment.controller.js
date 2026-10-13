const pool = require('../config/db');

/**
 * Helper to validate positive integer IDs
 */
const isValidPositiveInteger = (val) => {
  if (val === undefined || val === null || val === '') return false;
  const num = Number(val);
  return Number.isInteger(num) && num > 0;
};

const ALLOWED_PAYMENT_METHODS = ['Cash', 'Cheque', 'Bank Transfer', 'UPI', 'Card'];

/**
 * POST /api/payments
 * Admin only: Record manual payment for a pending fee installment
 * Multi-step transaction: locks installment FOR UPDATE, verifies full amount, inserts payment, updates status to PAID
 */
const recordPayment = async (req, res, next) => {
  const { installment_id, amount_paid, payment_method, reference_number, remarks } = req.body;

  // 1. Validate installment_id
  if (!isValidPositiveInteger(installment_id)) {
    return res.status(400).json({
      success: false,
      message: 'installment_id must be a valid positive integer'
    });
  }
  const installmentId = parseInt(installment_id, 10);

  // 2. Validate amount_paid
  if (amount_paid === undefined || amount_paid === null || amount_paid === '') {
    return res.status(400).json({
      success: false,
      message: 'amount_paid is required'
    });
  }
  if (typeof amount_paid === 'boolean') {
    return res.status(400).json({
      success: false,
      message: 'amount_paid must be a valid positive number'
    });
  }
  const paidNum = Number(amount_paid);
  if (isNaN(paidNum) || !isFinite(paidNum) || paidNum <= 0) {
    return res.status(400).json({
      success: false,
      message: 'amount_paid must be a valid positive number'
    });
  }

  // 3. Validate payment_method
  if (!payment_method || typeof payment_method !== 'string' || !ALLOWED_PAYMENT_METHODS.includes(payment_method.trim())) {
    return res.status(400).json({
      success: false,
      message: `payment_method must be one of: ${ALLOWED_PAYMENT_METHODS.join(', ')}`
    });
  }
  const normalizedMethod = payment_method.trim();

  // 4. Validate optional fields length
  if (reference_number !== undefined && reference_number !== null) {
    if (typeof reference_number !== 'string' || reference_number.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'reference_number must be a string up to 100 characters'
      });
    }
  }

  if (remarks !== undefined && remarks !== null) {
    if (typeof remarks !== 'string' || remarks.length > 500) {
      return res.status(400).json({
        success: false,
        message: 'remarks must be a string up to 500 characters'
      });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 5. Select and lock installment row FOR UPDATE
    const instLockRes = await client.query(
      `SELECT 
         fi.id, 
         fi.student_id, 
         fi.fee_structure_id, 
         fi.installment_number, 
         fi.amount, 
         fi.status, 
         fi.due_date,
         s.first_name,
         s.last_name,
         sec.name AS section_name,
         c.name AS class_name
       FROM fee_installments fi
       JOIN students s ON fi.student_id = s.id
       JOIN sections sec ON s.section_id = sec.id
       JOIN classes c ON sec.class_id = c.id
       WHERE fi.id = $1
       FOR UPDATE`,
      [installmentId]
    );

    if (instLockRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Fee installment not found'
      });
    }

    const installment = instLockRes.rows[0];

    // 6. Verify installment status is PENDING
    if (installment.status !== 'PENDING') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: `Installment #${installment.installment_number} is already paid`
      });
    }

    // 7. Verify no existing payment record exists for this installment
    const existingPaymentRes = await client.query(
      'SELECT id FROM payments WHERE installment_id = $1',
      [installmentId]
    );
    if (existingPaymentRes.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'A payment record already exists for this installment'
      });
    }

    // 8. Exact amount matching using integer minor units (cents/paise)
    const expectedCents = Math.round(Number(installment.amount) * 100);
    const paidCents = Math.round(paidNum * 100);

    if (paidCents !== expectedCents) {
      await client.query('ROLLBACK');
      if (paidCents < expectedCents) {
        return res.status(400).json({
          success: false,
          message: `Partial payments are not permitted. Amount paid (${paidNum.toFixed(2)}) must equal full installment amount (${Number(installment.amount).toFixed(2)}) exactly.`
        });
      } else {
        return res.status(400).json({
          success: false,
          message: `Overpayments are not permitted. Amount paid (${paidNum.toFixed(2)}) must equal full installment amount (${Number(installment.amount).toFixed(2)}) exactly.`
        });
      }
    }

    // 9. Generate unique receipt number
    const receiptNumber = `REC-${Date.now()}-${installmentId}`;

    // 10. Insert payment record
    const insertPaymentQuery = `
      INSERT INTO payments (
        installment_id,
        amount_paid,
        receipt_number,
        payment_method,
        reference_number,
        remarks
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, installment_id, amount_paid, receipt_number, payment_method, reference_number, remarks, payment_date;
    `;

    const paymentRes = await client.query(insertPaymentQuery, [
      installmentId,
      paidNum.toFixed(2),
      receiptNumber,
      normalizedMethod,
      reference_number ? reference_number.trim() : null,
      remarks ? remarks.trim() : null
    ]);

    const paymentRecord = paymentRes.rows[0];

    // 11. Update installment status to PAID
    const updateInstQuery = `
      UPDATE fee_installments
      SET status = 'PAID'
      WHERE id = $1
      RETURNING id, installment_number, amount, status;
    `;
    const updatedInstRes = await client.query(updateInstQuery, [installmentId]);

    // 12. Commit transaction
    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: 'Payment recorded successfully',
      data: {
        payment: {
          id: paymentRecord.id,
          receipt_number: paymentRecord.receipt_number,
          installment_id: paymentRecord.installment_id,
          installment_number: installment.installment_number,
          amount_paid: paymentRecord.amount_paid,
          payment_method: paymentRecord.payment_method,
          reference_number: paymentRecord.reference_number,
          remarks: paymentRecord.remarks,
          payment_date: paymentRecord.payment_date
        },
        student: {
          id: installment.student_id,
          name: `${installment.first_name} ${installment.last_name}`,
          class: installment.class_name,
          section: installment.section_name
        },
        installment: updatedInstRes.rows[0]
      }
    });

  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rbError) {
      console.error('Rollback error:', rbError.message);
    }

    // Translate unique constraint on payments.installment_id cleanly
    if (error.code === '23505' && error.constraint === 'payments_installment_id_key') {
      return res.status(409).json({
        success: false,
        message: 'Payment has already been recorded for this installment'
      });
    }

    next(error);
  } finally {
    client.release();
  }
};

/**
 * GET /api/payments/:id
 * Admin only: Retrieve payment receipt details with joined student, class, section, and installment details
 */
const getPaymentById = async (req, res, next) => {
  try {
    const idParam = req.params.id;
    if (!isValidPositiveInteger(idParam)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment ID'
      });
    }
    const paymentId = parseInt(idParam, 10);

    const query = `
      SELECT 
        p.id,
        p.receipt_number,
        p.amount_paid,
        p.payment_method,
        p.reference_number,
        p.remarks,
        p.payment_date,
        fi.id AS installment_id,
        fi.installment_number,
        fi.due_date,
        s.id AS student_id,
        s.first_name AS student_first_name,
        s.last_name AS student_last_name,
        sec.name AS section_name,
        c.name AS class_name,
        c.level AS class_level,
        fs.academic_year
      FROM payments p
      JOIN fee_installments fi ON p.installment_id = fi.id
      JOIN fee_structures fs ON fi.fee_structure_id = fs.id
      JOIN students s ON fi.student_id = s.id
      JOIN sections sec ON s.section_id = sec.id
      JOIN classes c ON sec.class_id = c.id
      WHERE p.id = $1;
    `;

    const result = await pool.query(query, [paymentId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Payment receipt not found'
      });
    }

    const row = result.rows[0];

    return res.status(200).json({
      success: true,
      data: {
        id: row.id,
        receipt_number: row.receipt_number,
        amount_paid: row.amount_paid,
        payment_method: row.payment_method,
        reference_number: row.reference_number,
        remarks: row.remarks,
        payment_date: row.payment_date,
        student: {
          id: row.student_id,
          name: `${row.student_first_name} ${row.student_last_name}`,
          class: row.class_name,
          class_level: row.class_level,
          section: row.section_name
        },
        installment: {
          id: row.installment_id,
          installment_number: row.installment_number,
          due_date: row.due_date,
          academic_year: row.academic_year
        }
      }
    });

  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/payments/:id
 * Admin only: Update editable fields of a recorded payment (method, reference number, remarks, payment_date)
 */
const updatePayment = async (req, res, next) => {
  try {
    const idParam = req.params.id;
    if (!isValidPositiveInteger(idParam)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment ID'
      });
    }
    const paymentId = parseInt(idParam, 10);

    const checkRes = await pool.query('SELECT * FROM payments WHERE id = $1', [paymentId]);
    if (checkRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Payment record not found'
      });
    }
    const current = checkRes.rows[0];

    const { payment_method, reference_number, remarks, payment_date } = req.body;

    let updatedMethod = current.payment_method;
    if (payment_method !== undefined) {
      if (!payment_method || typeof payment_method !== 'string' || !ALLOWED_PAYMENT_METHODS.includes(payment_method.trim())) {
        return res.status(400).json({
          success: false,
          message: `payment_method must be one of: ${ALLOWED_PAYMENT_METHODS.join(', ')}`
        });
      }
      updatedMethod = payment_method.trim();
    }

    let updatedRef = current.reference_number;
    if (reference_number !== undefined) {
      if (reference_number !== null && typeof reference_number === 'string') {
        if (reference_number.length > 100) {
          return res.status(400).json({
            success: false,
            message: 'reference_number must be up to 100 characters'
          });
        }
        updatedRef = reference_number.trim() || null;
      } else if (reference_number === null) {
        updatedRef = null;
      }
    }

    let updatedRemarks = current.remarks;
    if (remarks !== undefined) {
      if (remarks !== null && typeof remarks === 'string') {
        if (remarks.length > 500) {
          return res.status(400).json({
            success: false,
            message: 'remarks must be up to 500 characters'
          });
        }
        updatedRemarks = remarks.trim() || null;
      } else if (remarks === null) {
        updatedRemarks = null;
      }
    }

    let updatedDate = current.payment_date;
    if (payment_date !== undefined && payment_date !== null) {
      const parsed = new Date(payment_date);
      if (isNaN(parsed.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid payment_date'
        });
      }
      updatedDate = parsed;
    }

    const updateQuery = `
      UPDATE payments
      SET payment_method = $1, reference_number = $2, remarks = $3, payment_date = $4
      WHERE id = $5
      RETURNING id, installment_id, amount_paid, receipt_number, payment_method, reference_number, remarks, payment_date;
    `;
    const result = await pool.query(updateQuery, [updatedMethod, updatedRef, updatedRemarks, updatedDate, paymentId]);

    return res.status(200).json({
      success: true,
      message: 'Payment record updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/payments/:id
 * Admin only: Delete a payment record and atomically revert linked fee_installment status to PENDING
 */
const deletePayment = async (req, res, next) => {
  const idParam = req.params.id;
  if (!isValidPositiveInteger(idParam)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid payment ID'
    });
  }
  const paymentId = parseInt(idParam, 10);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const paymentRes = await client.query(
      'SELECT id, installment_id, receipt_number, amount_paid FROM payments WHERE id = $1 FOR UPDATE',
      [paymentId]
    );

    if (paymentRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Payment record not found'
      });
    }

    const payment = paymentRes.rows[0];

    // 1. Delete payment row
    await client.query('DELETE FROM payments WHERE id = $1', [paymentId]);

    // 2. Revert installment status back to PENDING
    const instUpdateRes = await client.query(
      "UPDATE fee_installments SET status = 'PENDING' WHERE id = $1 RETURNING id, student_id, installment_number, amount, status",
      [payment.installment_id]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      success: true,
      message: `Payment record ${payment.receipt_number} deleted and installment reverted to PENDING`,
      data: {
        deleted_payment_id: paymentId,
        receipt_number: payment.receipt_number,
        installment: instUpdateRes.rows[0]
      }
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
  recordPayment,
  getPaymentById,
  updatePayment,
  deletePayment
};
