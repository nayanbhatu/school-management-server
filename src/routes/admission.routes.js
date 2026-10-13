const express = require('express');
const router = express.Router();
const admissionController = require('../controllers/admission.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth.middleware');

// All admission application management endpoints are restricted to Admin role
router.use(authenticateToken, authorizeRoles('admin'));

// POST /api/admissions - Create a new admission application
router.post('/', admissionController.createAdmission);

// GET /api/admissions - List admission applications (optional ?status= filter)
router.get('/', admissionController.getAdmissions);

// GET /api/admissions/:id - Get details of a single admission application
router.get('/:id', admissionController.getAdmissionById);

// PATCH /api/admissions/:id/status - Approve or reject an admission application
router.patch('/:id/status', admissionController.updateAdmissionStatus);

module.exports = router;
