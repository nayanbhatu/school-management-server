const express = require('express');
const router = express.Router();
const subjectController = require('../controllers/subject.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth.middleware');

// Protected read route: any authenticated user
router.get('/', authenticateToken, subjectController.getSubjects);

// Admin-only write route: create subject
router.post('/', authenticateToken, authorizeRoles('admin'), subjectController.createSubject);

module.exports = router;
