const express = require('express');
const router = express.Router();
const teacherAssignmentController = require('../controllers/teacherAssignment.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth.middleware');

// Protected read route: any authenticated user
router.get('/', authenticateToken, teacherAssignmentController.getTeacherAssignments);

// Admin-only write routes
router.post('/', authenticateToken, authorizeRoles('admin'), teacherAssignmentController.createTeacherAssignment);
router.delete('/:id', authenticateToken, authorizeRoles('admin'), teacherAssignmentController.deleteTeacherAssignment);

module.exports = router;
