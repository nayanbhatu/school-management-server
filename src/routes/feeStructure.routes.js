const express = require('express');
const router = express.Router();
const feeStructureController = require('../controllers/feeStructure.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth.middleware');

// All fee structure routes are admin-only
router.use(authenticateToken, authorizeRoles('admin'));

// GET /api/fee-structures - List fee structures with optional filters
router.get('/', feeStructureController.getFeeStructures);

// POST /api/fee-structures - Create a new fee structure
router.post('/', feeStructureController.createFeeStructure);

// PUT /api/fee-structures/:id - Update an existing fee structure
router.put('/:id', feeStructureController.updateFeeStructure);

// DELETE /api/fee-structures/:id - Delete an existing fee structure
router.delete('/:id', feeStructureController.deleteFeeStructure);

module.exports = router;
