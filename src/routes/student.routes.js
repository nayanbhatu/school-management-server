const express = require('express');
const router = express.Router();
const studentController = require('../controllers/student.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth.middleware');

// All student enrollment and retrieval endpoints are restricted to Admin role
router.use(authenticateToken, authorizeRoles('admin'));

// POST /api/students/enroll - Enroll an approved admission application
router.post('/enroll', studentController.enrollStudent);

// GET /api/students - List enrolled students (optional ?class_id= & ?section_id= filters)
router.get('/', studentController.getStudents);

// GET /api/students/:id - Get detailed student profile with installments
router.get('/:id', studentController.getStudentById);

// GET /api/students/:id/fees - Get student fee structure, installments, and payment records
router.get('/:id/fees', studentController.getStudentFees);

module.exports = router;
