const express = require('express');
const router = express.Router();
const teacherController = require('../controllers/teacher.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth.middleware');

// GET /api/teachers - List all teachers (authenticated users)
router.get('/', authenticateToken, teacherController.getTeachers);

// GET /api/teachers/students - Teacher roster (authenticated teachers only)
router.get('/students', authenticateToken, authorizeRoles('teacher'), teacherController.getTeacherStudents);

// POST /api/teachers - Create teacher record & user login account (Admin only)
router.post('/', authenticateToken, authorizeRoles('admin'), teacherController.createTeacher);

// GET /api/teachers/:id - Get teacher details and assignments (authenticated users)
router.get('/:id', authenticateToken, teacherController.getTeacherById);

// PATCH & PUT /api/teachers/:id/status - Activate/Deactivate teacher account (Admin only)
router.patch('/:id/status', authenticateToken, authorizeRoles('admin'), teacherController.updateTeacherStatus);
router.put('/:id/status', authenticateToken, authorizeRoles('admin'), teacherController.updateTeacherStatus);

// PATCH & POST /api/teachers/:id/reset-password - Reset teacher credentials (Admin only)
router.patch('/:id/reset-password', authenticateToken, authorizeRoles('admin'), teacherController.resetTeacherPassword);
router.post('/:id/reset-password', authenticateToken, authorizeRoles('admin'), teacherController.resetTeacherPassword);

module.exports = router;
