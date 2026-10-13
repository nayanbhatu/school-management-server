const express = require('express');
const cors = require('cors');
const healthRoutes = require('./routes/health.routes');
const authRoutes = require('./routes/auth.routes');
const classRoutes = require('./routes/class.routes');
const subjectRoutes = require('./routes/subject.routes');
const teacherRoutes = require('./routes/teacher.routes');
const teacherPortalRoutes = require('./routes/teacherPortal.routes');
const teacherAssignmentRoutes = require('./routes/teacherAssignment.routes');
const admissionRoutes = require('./routes/admission.routes');
const studentRoutes = require('./routes/student.routes');
const feeStructureRoutes = require('./routes/feeStructure.routes');
const paymentRoutes = require('./routes/payment.routes');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/subjects', subjectRoutes);
app.use('/api/teachers', teacherRoutes);
app.use('/api/teacher', teacherPortalRoutes);
app.use('/api/teacher-assignments', teacherAssignmentRoutes);
app.use('/api/admissions', admissionRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/fee-structures', feeStructureRoutes);
app.use('/api/payments', paymentRoutes);

// Centralized error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Internal server error'
  });
});

module.exports = app;
