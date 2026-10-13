const express = require('express');
const router = express.Router();
const classController = require('../controllers/class.controller');
const { authenticateToken } = require('../middleware/auth.middleware');

// Protected read routes
router.get('/', authenticateToken, classController.getClasses);
router.get('/:id/sections', authenticateToken, classController.getClassSections);

module.exports = router;
