const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticateToken } = require('../middleware/auth.middleware');

// Public route: login
router.post('/login', authController.login);

// Protected route: get current authenticated user
router.get('/me', authenticateToken, authController.getMe);

module.exports = router;
