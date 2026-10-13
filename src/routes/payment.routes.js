const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/payment.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth.middleware');

// All payment routes are admin-only
router.use(authenticateToken, authorizeRoles('admin'));

// POST /api/payments - Record payment for an installment
router.post('/', paymentController.recordPayment);

// GET /api/payments/:id - Retrieve payment receipt details
router.get('/:id', paymentController.getPaymentById);

// PUT /api/payments/:id - Update editable fields of a payment
router.put('/:id', paymentController.updatePayment);

// DELETE /api/payments/:id - Delete payment and revert installment to PENDING
router.delete('/:id', paymentController.deletePayment);

module.exports = router;
