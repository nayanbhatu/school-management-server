const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// GET /api/health
router.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: "School Operations API is running"
  });
});

// GET /api/health/db
router.get('/db', async (req, res) => {
  try {
    const result = await pool.query('SELECT 1 AS connected');
    res.status(200).json({
      success: true,
      message: "PostgreSQL connection successful"
    });
  } catch (error) {
    console.error('Database connection error:', error.message);
    res.status(503).json({
      success: false,
      message: "Database connection failed"
    });
  }
});

module.exports = router;
