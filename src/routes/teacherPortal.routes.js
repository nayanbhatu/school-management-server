const express = require('express');
const router = express.Router();
const teacherController = require('../controllers/teacher.controller');
const { authenticateToken, authorizeRoles } = require('../middleware/auth.middleware');

// GET /api/teacher/students - Authenticated teachers only
router.get('/students', authenticateToken, authorizeRoles('teacher'), teacherController.getTeacherStudents);

// GET /api/teacher/assignments - Authenticated teachers only (strictly scoped to req.user.id)
router.get('/assignments', authenticateToken, authorizeRoles('teacher'), teacherController.getMyAssignments);

module.exports = router;
