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
 * GET /api/fee-structures
 * Admin only: List fee structures with optional ?class_id= and ?academic_year= filters
 */
const getFeeStructures = async (req, res, next) => {
  try {
    const { class_id, academic_year } = req.query;
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
      whereClauses.push(`fs.class_id = $${queryParams.length}`);
    }

    if (academic_year !== undefined) {
      if (typeof academic_year !== 'string' || !academic_year.trim()) {
        return res.status(400).json({
          success: false,
          message: 'academic_year filter must be a non-empty string'
        });
      }
      queryParams.push(academic_year.trim());
      whereClauses.push(`fs.academic_year = $${queryParams.length}`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const query = `
      SELECT 
        fs.id,
        fs.class_id,
        c.name AS class_name,
        c.level AS class_level,
        fs.academic_year,
        fs.annual_fee
      FROM fee_structures fs
      JOIN classes c ON fs.class_id = c.id
      ${whereSql}
      ORDER BY c.level ASC, fs.academic_year ASC, fs.id ASC;
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
 * POST /api/fee-structures
 * Admin only: Create a new fee structure
 */
const createFeeStructure = async (req, res, next) => {
  try {
    const { class_id, academic_year, annual_fee } = req.body;

    // 1. Validate class_id
    if (!isValidPositiveInteger(class_id)) {
      return res.status(400).json({
        success: false,
        message: 'class_id must be a valid positive integer'
      });
    }
    const classId = parseInt(class_id, 10);

    // 2. Validate academic_year format (e.g., YYYY-YYYY)
    if (!academic_year || typeof academic_year !== 'string' || !/^\d{4}-\d{4}$/.test(academic_year.trim())) {
      return res.status(400).json({
        success: false,
        message: 'academic_year is required and must follow YYYY-YYYY format (e.g., 2024-2025)'
      });
    }
    const academicYearTrimmed = academic_year.trim();

    // 3. Validate annual_fee
    if (annual_fee === undefined || annual_fee === null || annual_fee === '') {
      return res.status(400).json({
        success: false,
        message: 'annual_fee is required'
      });
    }
    const feeNum = Number(annual_fee);
    if (isNaN(feeNum) || feeNum <= 0) {
      return res.status(400).json({
        success: false,
        message: 'annual_fee must be a valid positive number'
      });
    }
    const feeFormatted = feeNum.toFixed(2);

    // 4. Verify class exists
    const classCheck = await pool.query('SELECT id, name, level FROM classes WHERE id = $1', [classId]);
    if (classCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Class with ID ${classId} not found`
      });
    }
    const classInfo = classCheck.rows[0];

    // 5. Insert fee structure
    const insertQuery = `
      INSERT INTO fee_structures (class_id, academic_year, annual_fee)
      VALUES ($1, $2, $3)
      RETURNING id, class_id, academic_year, annual_fee;
    `;

    const result = await pool.query(insertQuery, [classId, academicYearTrimmed, feeFormatted]);
    const created = result.rows[0];

    return res.status(201).json({
      success: true,
      message: 'Fee structure created successfully',
      data: {
        id: created.id,
        class_id: created.class_id,
        class_name: classInfo.name,
        class_level: classInfo.level,
        academic_year: created.academic_year,
        annual_fee: created.annual_fee
      }
    });

  } catch (error) {
    // Handle unique constraint: UNIQUE(class_id, academic_year)
    if (error.code === '23505' && error.constraint === 'fee_structures_class_id_academic_year_key') {
      return res.status(409).json({
        success: false,
        message: 'A fee structure already exists for this class and academic year'
      });
    }
    next(error);
  }
};

/**
 * PUT /api/fee-structures/:id
 * Admin only: Update existing fee structure
 * Preserves historical integrity: Updating annual_fee does NOT alter existing student installments
 */
const updateFeeStructure = async (req, res, next) => {
  try {
    const idParam = req.params.id;
    if (!isValidPositiveInteger(idParam)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid fee structure ID'
      });
    }
    const feeStructureId = parseInt(idParam, 10);

    // Check if fee structure exists
    const existingRes = await pool.query(
      `SELECT fs.id, fs.class_id, fs.academic_year, fs.annual_fee, c.name AS class_name, c.level AS class_level
       FROM fee_structures fs
       JOIN classes c ON fs.class_id = c.id
       WHERE fs.id = $1`,
      [feeStructureId]
    );

    if (existingRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Fee structure not found'
      });
    }

    const existing = existingRes.rows[0];
    const { annual_fee, class_id, academic_year } = req.body;

    // 1. Validate annual_fee if provided
    let newAnnualFee = existing.annual_fee;
    if (annual_fee !== undefined) {
      if (typeof annual_fee === 'boolean') {
        return res.status(400).json({
          success: false,
          message: 'annual_fee must be a valid positive number'
        });
      }
      const feeNum = Number(annual_fee);
      if (isNaN(feeNum) || !isFinite(feeNum) || feeNum <= 0) {
        return res.status(400).json({
          success: false,
          message: 'annual_fee must be a valid positive number'
        });
      }
      newAnnualFee = feeNum.toFixed(2);
    }

    // 2. Validate class_id if provided
    let newClassId = existing.class_id;
    if (class_id !== undefined) {
      if (!isValidPositiveInteger(class_id)) {
        return res.status(400).json({
          success: false,
          message: 'class_id must be a valid positive integer'
        });
      }
      newClassId = parseInt(class_id, 10);
      const clsCheck = await pool.query('SELECT id FROM classes WHERE id = $1', [newClassId]);
      if (clsCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: `Class with ID ${newClassId} not found`
        });
      }
    }

    // 3. Validate academic_year if provided
    let newAcademicYear = existing.academic_year;
    if (academic_year !== undefined) {
      if (typeof academic_year !== 'string' || !/^\d{4}-\d{4}$/.test(academic_year.trim())) {
        return res.status(400).json({
          success: false,
          message: 'academic_year must follow YYYY-YYYY format (e.g., 2024-2025)'
        });
      }
      newAcademicYear = academic_year.trim();
    }

    // 4. Integrity check: If attempting to modify class_id or academic_year, verify no installments exist
    const classIdModified = class_id !== undefined && newClassId !== existing.class_id;
    const academicYearModified = academic_year !== undefined && newAcademicYear !== existing.academic_year;

    if (classIdModified || academicYearModified) {
      const instCheck = await pool.query(
        'SELECT COUNT(*)::int AS count FROM fee_installments WHERE fee_structure_id = $1',
        [feeStructureId]
      );
      if (instCheck.rows[0].count > 0) {
        return res.status(409).json({
          success: false,
          message: 'Cannot modify class_id or academic_year for a fee structure that has existing student installments. Only annual_fee can be updated.'
        });
      }
    }

    // Update fee structure without touching historical installments
    const updateQuery = `
      UPDATE fee_structures
      SET class_id = $1, academic_year = $2, annual_fee = $3
      WHERE id = $4
      RETURNING id, class_id, academic_year, annual_fee;
    `;

    const updateRes = await pool.query(updateQuery, [newClassId, newAcademicYear, newAnnualFee, feeStructureId]);
    const updated = updateRes.rows[0];

    const clsDetails = await pool.query('SELECT name, level FROM classes WHERE id = $1', [updated.class_id]);

    return res.status(200).json({
      success: true,
      message: 'Fee structure updated successfully',
      data: {
        id: updated.id,
        class_id: updated.class_id,
        class_name: clsDetails.rows[0].name,
        class_level: clsDetails.rows[0].level,
        academic_year: updated.academic_year,
        annual_fee: updated.annual_fee
      }
    });

  } catch (error) {
    if (error.code === '23505' && error.constraint === 'fee_structures_class_id_academic_year_key') {
      return res.status(409).json({
        success: false,
        message: 'A fee structure already exists for this class and academic year'
      });
    }
    next(error);
  }
};

/**
 * DELETE /api/fee-structures/:id
 * Admin only: Delete a fee structure if it has no associated student installments
 */
const deleteFeeStructure = async (req, res, next) => {
  try {
    const idParam = req.params.id;
    if (!isValidPositiveInteger(idParam)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid fee structure ID'
      });
    }
    const feeStructureId = parseInt(idParam, 10);

    const checkRes = await pool.query(
      'SELECT id, academic_year, class_id FROM fee_structures WHERE id = $1',
      [feeStructureId]
    );

    if (checkRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Fee structure not found'
      });
    }

    // Integrity check: prevent deletion if student installments are associated
    const instCheck = await pool.query(
      'SELECT COUNT(*)::int AS count FROM fee_installments WHERE fee_structure_id = $1',
      [feeStructureId]
    );

    if (instCheck.rows[0].count > 0) {
      return res.status(409).json({
        success: false,
        message: 'Cannot delete fee structure because it has associated student fee installments. Historical financial records must be preserved.'
      });
    }

    await pool.query('DELETE FROM fee_structures WHERE id = $1', [feeStructureId]);

    return res.status(200).json({
      success: true,
      message: 'Fee structure deleted successfully',
      data: {
        id: feeStructureId
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getFeeStructures,
  createFeeStructure,
  updateFeeStructure,
  deleteFeeStructure
};
