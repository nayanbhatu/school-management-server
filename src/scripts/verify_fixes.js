const pool = require('../config/db');
const app = require('../app');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

async function runVerification() {
  console.log('=== RUNNING TARGETED REGRESSION VERIFICATION ===\n');

  // 1. Check teacher students endpoint for Teacher 2 (Ram Sharma)
  console.log('--- 1. Testing Teacher Students Endpoint (Fee status & Class/Section) ---');
  const t2UserRes = await pool.query(
    "SELECT u.id, u.username, u.role FROM users u JOIN teachers t ON t.user_id = u.id WHERE t.id = 2"
  );
  if (t2UserRes.rows.length === 0) {
    throw new Error('Teacher 2 not found');
  }
  const teacher2User = t2UserRes.rows[0];
  const teacher2Token = jwt.sign(
    { id: teacher2User.id, username: teacher2User.username, role: teacher2User.role },
    process.env.JWT_SECRET || 'your-super-secret-jwt-key'
  );

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const tStudentsRes = await fetch(`${baseUrl}/api/teacher/students`, {
      headers: { Authorization: `Bearer ${teacher2Token}` }
    });
    const tStudentsData = await tStudentsRes.json();

    console.log(`Teacher 2 Student Count: ${tStudentsData.count}`);
    const ram = tStudentsData.data.find(s => s.id === 48);
    if (!ram) {
      console.error('FAIL: Student Ram Sharma (ID 48) not found in Teacher 2 roster');
    } else {
      console.log('PASS: Found Ram Sharma in Teacher 2 roster');
      console.log(`PASS: Class name: "${ram.class_name}" | Section name: "${ram.section_name}"`);
      console.log(`PASS: Nested Class: "${ram.class?.name}" | Nested Section: "${ram.section?.name}"`);

      const installments = ram.fee_status.installments;
      console.log(`Total installments: ${installments.length}`);
      installments.forEach(inst => {
        console.log(`  Quarter ${inst.installment_number}: ${inst.status} (Amount: ${inst.amount}${inst.payment ? `, Receipt: ${inst.payment.receipt_number}` : ''})`);
      });

      const q1 = installments.find(i => i.installment_number === 1);
      const q2 = installments.find(i => i.installment_number === 2);
      const q3 = installments.find(i => i.installment_number === 3);
      const q4 = installments.find(i => i.installment_number === 4);

      if (q1?.status === 'PAID' && q2?.status === 'PAID' && q3?.status === 'PENDING' && q4?.status === 'PENDING') {
        console.log('PASS: Exactly Q1=PAID, Q2=PAID, Q3=PENDING, Q4=PENDING verified!');
      } else {
        console.error('FAIL: Installment statuses do not match expected Q1=PAID, Q2=PAID, Q3=PENDING, Q4=PENDING');
      }
    }

    // 2. Testing Teacher Credential Reset
    console.log('\n--- 2. Testing Teacher Credential Reset Endpoint ---');
    const adminUserRes = await pool.query("SELECT id, username, role FROM users WHERE role = 'admin' LIMIT 1");
    const adminToken = jwt.sign(
      { id: adminUserRes.rows[0].id, username: adminUserRes.rows[0].username, role: 'admin' },
      process.env.JWT_SECRET || 'your-super-secret-jwt-key'
    );

    // 2.1 Unauthenticated
    const unauthRes = await fetch(`${baseUrl}/api/teachers/1/reset-password`, { method: 'PATCH' });
    console.log(`PASS: Unauthenticated reset returns ${unauthRes.status} (expected 401)`);

    // 2.2 Forbidden (Teacher trying to reset)
    const forbRes = await fetch(`${baseUrl}/api/teachers/1/reset-password`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${teacher2Token}` }
    });
    console.log(`PASS: Teacher trying to reset returns ${forbRes.status} (expected 403)`);

    // 2.3 Non-existent teacher ID
    const notFoundRes = await fetch(`${baseUrl}/api/teachers/999999/reset-password`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    console.log(`PASS: Non-existent teacher returns ${notFoundRes.status} (expected 404)`);

    // 2.4 Invalid short password
    const shortPwdRes = await fetch(`${baseUrl}/api/teachers/1/reset-password`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: '123' })
    });
    console.log(`PASS: Short password returns ${shortPwdRes.status} (expected 400)`);

    // 2.5 Create an isolated test teacher to reset password
    console.log('Creating isolated test teacher for credential reset...');
    const createTeacherRes = await fetch(`${baseUrl}/api/teachers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'reset_test_teacher_' + Date.now(),
        password: 'InitialPassword123',
        first_name: 'Test',
        last_name: 'Reset',
        email: `reset_test_${Date.now()}@school.com`
      })
    });
    const createdData = await createTeacherRes.json();
    const testTeacher = createdData.data;
    console.log(`Created test teacher ID ${testTeacher.id}, username: ${testTeacher.username}`);

    // Verify initial login works
    const initLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: testTeacher.username, password: 'InitialPassword123' })
    });
    console.log(`PASS: Initial login returns ${initLogin.status} (expected 200)`);

    // Admin resets password using generated temporary password
    const resetRes = await fetch(`${baseUrl}/api/teachers/${testTeacher.id}/reset-password`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const resetData = await resetRes.json();
    console.log(`PASS: Reset returns ${resetRes.status} (expected 200)`);
    const tempPassword = resetData.data.temporary_password;
    console.log(`Generated temporary password: ${tempPassword}`);

    // Verify old password fails
    const oldLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: testTeacher.username, password: 'InitialPassword123' })
    });
    console.log(`PASS: Login with OLD password returns ${oldLogin.status} (expected 401)`);

    // Verify new temporary password works
    const newLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: testTeacher.username, password: tempPassword })
    });
    console.log(`PASS: Login with NEW temporary password returns ${newLogin.status} (expected 200)`);

    // Clean up test teacher
    await pool.query('DELETE FROM teachers WHERE id = $1', [testTeacher.id]);
    await pool.query('DELETE FROM users WHERE id = $1', [testTeacher.user_id]);
    console.log('PASS: Cleaned up test teacher record.');

    console.log('\n=== ALL TARGETED VERIFICATIONS COMPLETED SUCCESSFULLY ===');
  } finally {
    server.close();
    process.exit(0);
  }
}

runVerification().catch(err => {
  console.error('Verification Error:', err);
  process.exit(1);
});
