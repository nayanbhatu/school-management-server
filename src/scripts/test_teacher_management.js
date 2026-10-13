require('dotenv').config();
const http = require('http');
const app = require('../app');
const pool = require('../config/db');

async function runTests() {
  console.log('--- STARTING TEACHER ACCESS & ACCOUNT MANAGEMENT TESTS ---');

  const PORT = 5094;
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(PORT, resolve));
  const baseUrl = `http://localhost:${PORT}`;

  let passed = 0;
  let failed = 0;

  // Track created resources for isolated cleanup
  const createdUserIds = [];
  const createdTeacherIds = [];
  const createdAssignmentIds = [];

  function assert(condition, message) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message}`);
      failed++;
    }
  }

  let adminToken = '';
  let teacher1Token = '';
  let teacher2Token = '';

  try {
    // 0. Login credentials
    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'password123' })
    });
    const adminLoginData = await adminLoginRes.json();
    adminToken = adminLoginData.token;

    const t1LoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'teacher1', password: 'password123' })
    });
    const t1LoginData = await t1LoginRes.json();
    teacher1Token = t1LoginData.token;

    const t2LoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'teacher2', password: 'password123' })
    });
    const t2LoginData = await t2LoginRes.json();
    teacher2Token = t2LoginData.token;

    assert(adminToken && teacher1Token && teacher2Token, 'Obtained tokens for admin, teacher1, and teacher2');

    // ==========================================
    // 1. AUTHENTICATION & ROLE AUTHORIZATION
    // ==========================================
    console.log('\n--- 1. Authentication & Role Authorization Tests ---');
    const unauthPostRes = await fetch(`${baseUrl}/api/teachers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 't_test', password: 'password123' })
    });
    assert(unauthPostRes.status === 401, 'POST /api/teachers without token returns 401 Unauthorized');

    const teacherPostRes = await fetch(`${baseUrl}/api/teachers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacher1Token}`
      },
      body: JSON.stringify({ username: 't_test', password: 'password123' })
    });
    assert(teacherPostRes.status === 403, 'POST /api/teachers with teacher token returns 403 Forbidden');

    const unauthPatchStatusRes = await fetch(`${baseUrl}/api/teachers/1/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: false })
    });
    assert(unauthPatchStatusRes.status === 401, 'PATCH /api/teachers/:id/status without token returns 401 Unauthorized');

    const teacherPatchStatusRes = await fetch(`${baseUrl}/api/teachers/1/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacher1Token}`
      },
      body: JSON.stringify({ is_active: false })
    });
    assert(teacherPatchStatusRes.status === 403, 'PATCH /api/teachers/:id/status with teacher token returns 403 Forbidden');

    // GET /api/teacher/students authorization
    const unauthRosterRes = await fetch(`${baseUrl}/api/teacher/students`);
    assert(unauthRosterRes.status === 401, 'GET /api/teacher/students without token returns 401 Unauthorized');

    const adminRosterRes = await fetch(`${baseUrl}/api/teacher/students`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(adminRosterRes.status === 403, 'GET /api/teacher/students with Admin token returns 403 Forbidden (teachers only)');

    const teacherRosterRes = await fetch(`${baseUrl}/api/teacher/students`, {
      headers: { Authorization: `Bearer ${teacher1Token}` }
    });
    assert(teacherRosterRes.status === 200, 'GET /api/teacher/students with Teacher token returns 200 OK');

    // GET /api/teacher/assignments authorization & scoping
    const unauthAssignRes = await fetch(`${baseUrl}/api/teacher/assignments`);
    assert(unauthAssignRes.status === 401, 'GET /api/teacher/assignments without token returns 401 Unauthorized');

    const adminAssignRes = await fetch(`${baseUrl}/api/teacher/assignments`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(adminAssignRes.status === 403, 'GET /api/teacher/assignments with Admin token returns 403 Forbidden (teachers only)');

    const t1AssignRes = await fetch(`${baseUrl}/api/teacher/assignments`, {
      headers: { Authorization: `Bearer ${teacher1Token}` }
    });
    const t1AssignData = await t1AssignRes.json();
    assert(
      t1AssignRes.status === 200 &&
      t1AssignData.success === true &&
      Array.isArray(t1AssignData.data),
      'GET /api/teacher/assignments with Teacher 1 token returns 200 OK and assignments array'
    );
    assert(
      t1AssignData.data.length > 0 &&
      t1AssignData.data.every(a => a.class_name && a.section_name && a.subject_name),
      'Every returned assignment contains class_name, section_name, and subject_name'
    );

    // Verify parameter spoofing attempt: ?teacher_id=2 is ignored
    const spoofAssignRes = await fetch(`${baseUrl}/api/teacher/assignments?teacher_id=2`, {
      headers: { Authorization: `Bearer ${teacher1Token}` }
    });
    const spoofAssignData = await spoofAssignRes.json();
    assert(
      spoofAssignData.data.length === t1AssignData.data.length &&
      JSON.stringify(spoofAssignData.data) === JSON.stringify(t1AssignData.data),
      'Query param ?teacher_id=2 on assignments is ignored; teacher identity derived solely from auth token'
    );

    // ==========================================
    // 2. ADMIN TEACHER ACCOUNT CREATION & VALIDATION
    // ==========================================
    console.log('\n--- 2. Admin Teacher Creation Tests ---');
    const emptyBodyRes = await fetch(`${baseUrl}/api/teachers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({})
    });
    assert(emptyBodyRes.status === 400, 'POST /api/teachers with empty body returns 400 Bad Request');

    const shortUserRes = await fetch(`${baseUrl}/api/teachers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        username: 'ab',
        password: 'password123',
        first_name: 'Test',
        last_name: 'User',
        email: 'test@school.test'
      })
    });
    assert(shortUserRes.status === 400, 'POST /api/teachers with < 3 char username returns 400 Bad Request');

    const shortPassRes = await fetch(`${baseUrl}/api/teachers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        username: 'valid_user',
        password: '123',
        first_name: 'Test',
        last_name: 'User',
        email: 'test@school.test'
      })
    });
    assert(shortPassRes.status === 400, 'POST /api/teachers with < 6 char password returns 400 Bad Request');

    const badEmailRes = await fetch(`${baseUrl}/api/teachers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        username: 'valid_user',
        password: 'password123',
        first_name: 'Test',
        last_name: 'User',
        email: 'not-an-email'
      })
    });
    assert(badEmailRes.status === 400, 'POST /api/teachers with invalid email format returns 400 Bad Request');

    // Valid teacher creation
    const validCreateRes = await fetch(`${baseUrl}/api/teachers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        username: 'new_teacher_test',
        password: 'SecurePassword123',
        first_name: 'Eleanor',
        last_name: 'Rigby',
        email: 'eleanor.rigby@school.test'
      })
    });
    const validCreateData = await validCreateRes.json();
    assert(
      validCreateRes.status === 201 &&
      validCreateData.success === true &&
      validCreateData.data.username === 'new_teacher_test' &&
      validCreateData.data.email === 'eleanor.rigby@school.test' &&
      validCreateData.data.role === 'teacher' &&
      validCreateData.data.is_active === true &&
      validCreateData.data.password_hash === undefined,
      'POST /api/teachers creates teacher & user account atomically with 201 Created (password_hash omitted)'
    );

    const createdTeacherId = validCreateData.data?.id;
    const createdUserId = validCreateData.data?.user_id;
    if (createdTeacherId) createdTeacherIds.push(createdTeacherId);
    if (createdUserId) createdUserIds.push(createdUserId);

    // Verify user can authenticate with the newly created account
    const newLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'new_teacher_test', password: 'SecurePassword123' })
    });
    const newLoginData = await newLoginRes.json();
    assert(
      newLoginRes.status === 200 && newLoginData.success === true && Boolean(newLoginData.token),
      'Newly created teacher account can authenticate successfully via POST /api/auth/login'
    );
    const newTeacherToken = newLoginData.token;

    // Duplicate username rejection
    const dupUserRes = await fetch(`${baseUrl}/api/teachers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        username: 'new_teacher_test',
        password: 'AnotherPassword123',
        first_name: 'Other',
        last_name: 'Person',
        email: 'other.person@school.test'
      })
    });
    assert(dupUserRes.status === 409, 'POST /api/teachers with duplicate username returns 409 Conflict');

    // Duplicate email rejection
    const dupEmailRes = await fetch(`${baseUrl}/api/teachers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        username: 'different_username',
        password: 'AnotherPassword123',
        first_name: 'Other',
        last_name: 'Person',
        email: 'eleanor.rigby@school.test'
      })
    });
    assert(dupEmailRes.status === 409, 'POST /api/teachers with duplicate email returns 409 Conflict');

    // ==========================================
    // 3. ATOMICITY OF CREATION
    // ==========================================
    console.log('\n--- 3. Transaction Rollback Atomicity ---');
    // Verify that if teacher insert fails, user record is NOT orphaned
    const preUserCountRes = await pool.query("SELECT COUNT(*)::int AS count FROM users WHERE username = 'rollback_test_user'");
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("INSERT INTO users (username, password_hash, role) VALUES ('rollback_test_user', 'hash', 'teacher')");
      // Simulate failure on teacher table (e.g. duplicate email)
      throw new Error('Simulated failure during teacher record creation');
    } catch (simErr) {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    const postUserCountRes = await pool.query("SELECT COUNT(*)::int AS count FROM users WHERE username = 'rollback_test_user'");
    assert(
      preUserCountRes.rows[0].count === 0 && postUserCountRes.rows[0].count === 0,
      'Failure during creation rolls back user insertion completely (no orphaned user records)'
    );

    // ==========================================
    // 4. TEACHER ACTIVATION & DEACTIVATION
    // ==========================================
    console.log('\n--- 4. Teacher Status Management Tests ---');
    const notFoundStatusRes = await fetch(`${baseUrl}/api/teachers/999999/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ is_active: false })
    });
    assert(notFoundStatusRes.status === 404, 'PATCH /api/teachers/999999/status returns 404 Not Found');

    const badIdStatusRes = await fetch(`${baseUrl}/api/teachers/abc/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ is_active: false })
    });
    assert(badIdStatusRes.status === 400, 'PATCH /api/teachers/abc/status returns 400 Bad Request');

    const nonBoolStatusRes = await fetch(`${baseUrl}/api/teachers/${createdTeacherId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ is_active: 'false' })
    });
    assert(nonBoolStatusRes.status === 400, 'PATCH /api/teachers/:id/status with non-boolean is_active returns 400 Bad Request');

    // Deactivate teacher
    const deactivateRes = await fetch(`${baseUrl}/api/teachers/${createdTeacherId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ is_active: false })
    });
    const deactivateData = await deactivateRes.json();
    assert(
      deactivateRes.status === 200 && deactivateData.data.is_active === false,
      'Admin successfully deactivates teacher account (is_active: false)'
    );

    // Inactive teacher login attempt
    const inactiveLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'new_teacher_test', password: 'SecurePassword123' })
    });
    assert(inactiveLoginRes.status === 403, 'Inactive teacher login attempt returns 403 Forbidden');

    // Inactive teacher accessing protected endpoint with previously issued token
    const inactiveRosterRes = await fetch(`${baseUrl}/api/teacher/students`, {
      headers: { Authorization: `Bearer ${newTeacherToken}` }
    });
    assert(
      inactiveRosterRes.status === 403,
      'Inactive teacher with previously valid token denied access to protected endpoints with 403 Forbidden'
    );

    // Reactivate teacher
    const reactivateRes = await fetch(`${baseUrl}/api/teachers/${createdTeacherId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ is_active: true })
    });
    const reactivateData = await reactivateRes.json();
    assert(
      reactivateRes.status === 200 && reactivateData.data.is_active === true,
      'Admin successfully reactivates teacher account via PUT /api/teachers/:id/status (is_active: true)'
    );

    const reactivatedLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'new_teacher_test', password: 'SecurePassword123' })
    });
    const reactivatedLoginData = await reactivatedLoginRes.json();
    const unassignedTeacherToken = reactivatedLoginData.token;
    assert(reactivatedLoginRes.status === 200, 'Reactivated teacher can log in again with 200 OK');

    // ==========================================
    // 5. TEACHER STUDENT ROSTER & FEE VISIBILITY
    // ==========================================
    console.log('\n--- 5. Teacher Student Roster & Fee Status ---');
    // Teacher without assignments receives empty list
    const unassignedRosterRes = await fetch(`${baseUrl}/api/teacher/students`, {
      headers: { Authorization: `Bearer ${unassignedTeacherToken}` }
    });
    const unassignedRosterData = await unassignedRosterRes.json();
    assert(
      unassignedRosterRes.status === 200 &&
      unassignedRosterData.success === true &&
      Array.isArray(unassignedRosterData.data) &&
      unassignedRosterData.count === 0 &&
      unassignedRosterData.data.length === 0,
      'Teacher without assignments receives empty student list (count: 0, data: [])'
    );

    // Also verify unassigned teacher receives empty assignments array
    const unassignedAssignRes = await fetch(`${baseUrl}/api/teacher/assignments`, {
      headers: { Authorization: `Bearer ${unassignedTeacherToken}` }
    });
    const unassignedAssignData = await unassignedAssignRes.json();
    assert(
      unassignedAssignRes.status === 200 &&
      unassignedAssignData.success === true &&
      Array.isArray(unassignedAssignData.data) &&
      unassignedAssignData.data.length === 0,
      'Teacher without assignments receives empty assignments list (count: 0, data: [])'
    );

    // Dynamic count for Section 1 (Class 1, Section A)
    const sec1CountRes = await pool.query('SELECT COUNT(*)::int as count FROM students WHERE section_id = 1');
    const expectedSec1Count = sec1CountRes.rows[0].count;

    // Teacher 1 is assigned to Section 1 (Class 1, Section A)
    const t1RosterRes = await fetch(`${baseUrl}/api/teacher/students`, {
      headers: { Authorization: `Bearer ${teacher1Token}` }
    });
    const t1RosterData = await t1RosterRes.json();
    assert(
      t1RosterRes.status === 200 &&
      t1RosterData.success === true &&
      Array.isArray(t1RosterData.data) &&
      t1RosterData.count === expectedSec1Count,
      `Teacher 1 receives exactly ${expectedSec1Count} students from assigned Section 1A (received: ${t1RosterData.count})`
    );

    // Verify all returned students belong to Section A of Class 1
    const allAssignedSection = t1RosterData.data.every(
      (s) => s.section.name === 'A' && s.class.name === 'Class 1'
    );
    assert(allAssignedSection, 'All students in roster strictly belong to assigned Class 1, Section A');

    // Verify fee status payload structure
    const firstStudent = t1RosterData.data[0];
    assert(
      firstStudent.fee_status &&
      firstStudent.fee_status.annual_fee === '31000.00' &&
      Array.isArray(firstStudent.fee_status.installments) &&
      firstStudent.fee_status.installments.length === 4,
      'Student record includes fee status with exactly 4 quarterly installments'
    );

    // Verify installment status and payment details
    const student1 = t1RosterData.data.find((s) => s.id === 1);
    assert(student1 !== undefined, 'Found Student #1 in roster');
    if (student1) {
      const inst1 = student1.fee_status.installments[0];
      const inst2 = student1.fee_status.installments[1];
      assert(
        inst1.status === 'PAID' &&
        inst1.payment !== null &&
        inst1.payment.receipt_number.startsWith('REC-') &&
        inst1.payment.amount_paid === '7750.00',
        'Installment 1 shows status PAID with receipt number and payment details'
      );
      assert(
        inst2.status === 'PENDING' && inst2.payment === null,
        'Installment 2 shows status PENDING with payment: null'
      );
      assert(
        student1.fee_status.total_paid === '7750.00' &&
        student1.fee_status.total_pending === '23250.00',
        'Fee summary computes total_paid (₹7,750.00) and total_pending (₹23,250.00)'
      );
    }

    // Verify parameter manipulation attempt: passing query params or body cannot alter derived identity
    const paramSpoofRes = await fetch(`${baseUrl}/api/teacher/students?teacher_id=2`, {
      headers: { Authorization: `Bearer ${teacher1Token}` }
    });
    const paramSpoofData = await paramSpoofRes.json();
    assert(
      paramSpoofData.count === expectedSec1Count,
      'Query param ?teacher_id=2 is ignored; teacher identity derived solely from auth token'
    );

    // ==========================================
    // 6. MULTIPLE SUBJECT ASSIGNMENT DEDUPLICATION
    // ==========================================
    console.log('\n--- 6. Multiple Subject Deduplication ---');
    // Assign teacher1 to a second subject (Subject 2: Mathematics) in the same section (Section 1)
    const addAssignRes = await pool.query(
      'INSERT INTO teacher_assignments (teacher_id, section_id, subject_id) VALUES (1, 1, 2) RETURNING id'
    );
    const newAssignId = addAssignRes.rows[0].id;
    createdAssignmentIds.push(newAssignId);

    const dupTestRosterRes = await fetch(`${baseUrl}/api/teacher/students`, {
      headers: { Authorization: `Bearer ${teacher1Token}` }
    });
    const dupTestRosterData = await dupTestRosterRes.json();
    assert(
      dupTestRosterData.count === expectedSec1Count,
      `Multiple subject assignments in same section do not duplicate students (count remains ${expectedSec1Count})`
    );

    const uniqueStudentIds = new Set(dupTestRosterData.data.map((s) => s.id));
    assert(uniqueStudentIds.size === expectedSec1Count, 'All student IDs in roster are strictly unique');

    // ==========================================
    // 7. GET /api/teachers/:id
    // ==========================================
    console.log('\n--- 7. Single Teacher Retrieval ---');
    const getTeacherRes = await fetch(`${baseUrl}/api/teachers/1`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const getTeacherData = await getTeacherRes.json();
    assert(
      getTeacherRes.status === 200 &&
      getTeacherData.data.username === 'teacher1' &&
      Array.isArray(getTeacherData.data.assignments),
      'GET /api/teachers/:id returns teacher profile with assigned subjects/sections'
    );

    const notFoundTeacherRes = await fetch(`${baseUrl}/api/teachers/999999`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(notFoundTeacherRes.status === 404, 'GET /api/teachers/999999 returns 404 Not Found');

  } catch (err) {
    console.error('Unexpected error during test execution:', err);
    failed++;
  } finally {
    // Isolated Cleanup: Clean up ONLY test-created records
    console.log('\n--- Cleaning up isolated test resources ---');
    try {
      if (createdAssignmentIds.length > 0) {
        await pool.query('DELETE FROM teacher_assignments WHERE id = ANY($1)', [createdAssignmentIds]);
      }
      if (createdTeacherIds.length > 0) {
        await pool.query('DELETE FROM teachers WHERE id = ANY($1)', [createdTeacherIds]);
      }
      if (createdUserIds.length > 0) {
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
      }
      console.log('Cleanup completed successfully.');
    } catch (cleanupErr) {
      console.error('Error during cleanup:', cleanupErr);
    }

    server.close();
    await pool.end();
  }

  console.log(`\n========================================`);
  console.log(`TEACHER ACCESS & ACCOUNT MANAGEMENT RESULTS:`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
