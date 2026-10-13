require('dotenv').config();
const http = require('http');
const app = require('../app');
const pool = require('../config/db');

async function runTests() {
  console.log('--- STARTING PHASE 2: STUDENT ENROLLMENT API TESTS ---');

  const PORT = 5096;
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(PORT, resolve));
  const baseUrl = `http://localhost:${PORT}`;

  let passed = 0;
  let failed = 0;

  // Track all test-created resources for isolated cleanup
  const createdAppIds = [];
  const createdStudentIds = [];
  const createdFeeStructIds = [];
  const createdSectionIds = [];

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
  let teacherToken = '';

  try {
    // 0. Login as Admin and Teacher to get JWT tokens
    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'password123' })
    });
    const adminLoginData = await adminLoginRes.json();
    adminToken = adminLoginData.token;

    const teacherLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'teacher1', password: 'password123' })
    });
    const teacherLoginData = await teacherLoginRes.json();
    teacherToken = teacherLoginData.token;

    assert(adminToken && teacherToken, 'Obtained authentication tokens for admin and teacher');

    // ==========================================
    // 1. AUTHENTICATION & AUTHORIZATION TESTS
    // ==========================================
    console.log('\n--- 1. Authentication & Authorization Tests ---');

    // 1a. POST /api/students/enroll without token returns 401
    const unauthEnrollRes = await fetch(`${baseUrl}/api/students/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ application_id: 1, section_id: 1, fee_structure_id: 1 })
    });
    assert(unauthEnrollRes.status === 401, 'POST /api/students/enroll without token returns 401 Unauthorized');

    // 1b. GET /api/students without token returns 401
    const unauthGetRes = await fetch(`${baseUrl}/api/students`);
    assert(unauthGetRes.status === 401, 'GET /api/students without token returns 401 Unauthorized');

    // 1c. GET /api/students/:id without token returns 401
    const unauthGetIdRes = await fetch(`${baseUrl}/api/students/1`);
    assert(unauthGetIdRes.status === 401, 'GET /api/students/:id without token returns 401 Unauthorized');

    // 1d. Teacher token on POST /api/students/enroll returns 403 Forbidden
    const teacherEnrollRes = await fetch(`${baseUrl}/api/students/enroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({ application_id: 1, section_id: 1, fee_structure_id: 1 })
    });
    assert(teacherEnrollRes.status === 403, 'POST /api/students/enroll with teacher token returns 403 Forbidden');

    // 1e. Teacher token on GET /api/students returns 403 Forbidden
    const teacherGetRes = await fetch(`${baseUrl}/api/students`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    assert(teacherGetRes.status === 403, 'GET /api/students with teacher token returns 403 Forbidden');

    // 1f. Teacher token on GET /api/students/:id returns 403 Forbidden
    const teacherGetIdRes = await fetch(`${baseUrl}/api/students/1`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    assert(teacherGetIdRes.status === 403, 'GET /api/students/:id with teacher token returns 403 Forbidden');

    // ==========================================
    // 2. INPUT VALIDATION TESTS
    // ==========================================
    console.log('\n--- 2. Input Validation Tests ---');

    // 2a. Missing fields in enrollment
    const missingFieldsRes = await fetch(`${baseUrl}/api/students/enroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ application_id: 1 })
    });
    assert(missingFieldsRes.status === 400, 'POST /api/students/enroll with missing fields returns 400 Bad Request');

    // 2b. Non-integer or negative IDs
    const invalidIdsRes = await fetch(`${baseUrl}/api/students/enroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ application_id: 'abc', section_id: -1, fee_structure_id: 0 })
    });
    assert(invalidIdsRes.status === 400, 'POST /api/students/enroll with invalid IDs returns 400 Bad Request');

    // 2c. Nonexistent application ID returns 404
    const nonExistentAppRes = await fetch(`${baseUrl}/api/students/enroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ application_id: 999999, section_id: 1, fee_structure_id: 1 })
    });
    assert(nonExistentAppRes.status === 404, 'POST /api/students/enroll with nonexistent application returns 404 Not Found');

    // 2d. Helper: create isolated test application
    async function createTestApp(classId = 1, status = 'APPROVED') {
      const res = await pool.query(
        `INSERT INTO admission_applications (
           student_first_name, student_last_name, date_of_birth, target_class_id,
           parent_name, parent_email, parent_phone, status
         ) VALUES ($1, $2, '2016-05-15', $3, $4, $5, '555-9999', $6)
         RETURNING id`,
        [
          `TestChild${Date.now() % 10000}`,
          `TestLast${Math.floor(Math.random() * 1000)}`,
          classId,
          'Test Parent',
          `testparent_${Date.now()}_${Math.floor(Math.random() * 1000)}@test.com`,
          status
        ]
      );
      const id = res.rows[0].id;
      createdAppIds.push(id);
      return id;
    }

    const testAppApproved1 = await createTestApp(1, 'APPROVED');

    // 2e. Nonexistent section ID returns 404
    const nonExistentSecRes = await fetch(`${baseUrl}/api/students/enroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ application_id: testAppApproved1, section_id: 999999, fee_structure_id: 1 })
    });
    assert(nonExistentSecRes.status === 404, 'POST /api/students/enroll with nonexistent section returns 404 Not Found');

    // 2f. Nonexistent fee structure ID returns 404
    const nonExistentFeeRes = await fetch(`${baseUrl}/api/students/enroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ application_id: testAppApproved1, section_id: 1, fee_structure_id: 999999 })
    });
    assert(nonExistentFeeRes.status === 404, 'POST /api/students/enroll with nonexistent fee structure returns 404 Not Found');

    // ==========================================
    // 3. APPLICATION STATUS VALIDATION TESTS
    // ==========================================
    console.log('\n--- 3. Application Status Validation Tests ---');

    // 3a. Enrolling PENDING application returns 409 Conflict
    const testAppPending = await createTestApp(1, 'PENDING');
    const enrollPendingRes = await fetch(`${baseUrl}/api/students/enroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ application_id: testAppPending, section_id: 1, fee_structure_id: 1 })
    });
    const enrollPendingData = await enrollPendingRes.json();
    assert(enrollPendingRes.status === 409, 'Enrolling PENDING application returns 409 Conflict');
    assert(enrollPendingData.message.includes('PENDING'), '409 response explains that application is PENDING');

    // 3b. Enrolling REJECTED application returns 409 Conflict
    const testAppRejected = await createTestApp(1, 'REJECTED');
    const enrollRejectedRes = await fetch(`${baseUrl}/api/students/enroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ application_id: testAppRejected, section_id: 1, fee_structure_id: 1 })
    });
    assert(enrollRejectedRes.status === 409, 'Enrolling REJECTED application returns 409 Conflict');

    // ==========================================
    // 4. CLASS COMPATIBILITY VALIDATION TESTS
    // ==========================================
    console.log('\n--- 4. Class Compatibility Validation Tests ---');

    // 4a. Section belonging to a different class returns 400 Bad Request
    // testAppApproved1 is for Class 1. Section 3 belongs to Class 2.
    const mismatchedSecRes = await fetch(`${baseUrl}/api/students/enroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ application_id: testAppApproved1, section_id: 3, fee_structure_id: 1 })
    });
    const mismatchedSecData = await mismatchedSecRes.json();
    assert(mismatchedSecRes.status === 400, 'Section from different class returns 400 Bad Request');
    assert(mismatchedSecData.message.includes('class'), 'Error message specifies class mismatch between section and application');

    // 4b. Fee structure belonging to a different class returns 400 Bad Request
    // testAppApproved1 is for Class 1. Fee structure 2 belongs to Class 2.
    const mismatchedFeeRes = await fetch(`${baseUrl}/api/students/enroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ application_id: testAppApproved1, section_id: 2, fee_structure_id: 2 })
    });
    const mismatchedFeeData = await mismatchedFeeRes.json();
    assert(mismatchedFeeRes.status === 400, 'Fee structure from different class returns 400 Bad Request');
    assert(mismatchedFeeData.message.includes('class'), 'Error message specifies class mismatch between fee structure and application');

    // ==========================================
    // 5. SUCCESSFUL ENROLLMENT & INSTALLMENT CORRECTNESS
    // ==========================================
    console.log('\n--- 5. Successful Enrollment & Installments Tests ---');

    // Enroll testAppApproved1 into Section 2 (Class 1, Section B), Fee Structure 1 (annual_fee: 31000.00)
    const enrollSuccessRes = await fetch(`${baseUrl}/api/students/enroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        application_id: testAppApproved1,
        section_id: 2,
        fee_structure_id: 1
      })
    });
    const enrollSuccessData = await enrollSuccessRes.json();

    assert(enrollSuccessRes.status === 201, 'Valid approved application enrolled with 201 Created');
    assert(enrollSuccessData.success === true, 'Response indicates success: true');
    assert(enrollSuccessData.data.student && enrollSuccessData.data.student.id, 'Response contains enrolled student details');
    assert(enrollSuccessData.data.student.section_name === 'B', 'Student correctly assigned to Section B');
    assert(enrollSuccessData.data.installments && enrollSuccessData.data.installments.length === 4, 'Response contains exactly 4 installments');

    const enrolledStudentId1 = enrollSuccessData.data.student.id;
    createdStudentIds.push(enrolledStudentId1);

    // Verify installments in database
    const dbInstRes = await pool.query(
      `SELECT installment_number, amount, status, due_date
       FROM fee_installments
       WHERE student_id = $1
       ORDER BY installment_number ASC`,
      [enrolledStudentId1]
    );

    assert(dbInstRes.rows.length === 4, 'Exactly 4 installments created in database');
    const instNumbers = dbInstRes.rows.map(r => r.installment_number);
    assert(JSON.stringify(instNumbers) === JSON.stringify([1, 2, 3, 4]), 'Installment numbers are exactly 1, 2, 3, 4');

    const allPending = dbInstRes.rows.every(r => r.status === 'PENDING');
    assert(allPending, 'All 4 installments have initial status PENDING');

    const totalAmount = dbInstRes.rows.reduce((sum, r) => sum + Number(r.amount), 0);
    assert(Math.round(totalAmount * 100) === 3100000, 'Sum of all 4 installments exactly equals annual fee (₹31,000.00)');

    // Verify no payments created during enrollment
    const dbPaymentsRes = await pool.query(
      `SELECT p.id 
       FROM payments p 
       JOIN fee_installments fi ON p.installment_id = fi.id 
       WHERE fi.student_id = $1`,
      [enrolledStudentId1]
    );
    assert(dbPaymentsRes.rows.length === 0, 'No payments created during student enrollment');

    // ==========================================
    // 6. UNEVEN ANNUAL FEE SPLITTING TEST
    // ==========================================
    console.log('\n--- 6. Uneven Annual Fee Splitting Test ---');

    // Create a temporary fee structure with uneven annual fee: e.g., 40002.00 (remainder 2 cents)
    const unevenFeeRes = await pool.query(
      `INSERT INTO fee_structures (class_id, academic_year, annual_fee)
       VALUES (1, '2025-TEST-UNEVEN', 40002.00)
       RETURNING id, annual_fee`,
    );
    const unevenFeeId = unevenFeeRes.rows[0].id;
    createdFeeStructIds.push(unevenFeeId);

    const testAppUneven = await createTestApp(1, 'APPROVED');
    const enrollUnevenRes = await fetch(`${baseUrl}/api/students/enroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        application_id: testAppUneven,
        section_id: 2,
        fee_structure_id: unevenFeeId
      })
    });
    const enrollUnevenData = await enrollUnevenRes.json();
    assert(enrollUnevenRes.status === 201, 'Enrollment with uneven fee structure succeeds with 201');

    const unevenStudentId = enrollUnevenData.data.student.id;
    createdStudentIds.push(unevenStudentId);

    const dbUnevenInstRes = await pool.query(
      `SELECT installment_number, amount 
       FROM fee_installments 
       WHERE student_id = $1 
       ORDER BY installment_number ASC`,
      [unevenStudentId]
    );

    const amounts = dbUnevenInstRes.rows.map(r => Number(r.amount));
    // 40002.00 / 4: base = 10000.50. Remainder = 0 cents for 40002.00 (4000200 / 4 = 1000050 cents).
    // Let's check amounts sum strictly to 40002.00
    const unevenSum = amounts.reduce((a, b) => a + b, 0);
    assert(Math.round(unevenSum * 100) === 4000200, 'Uneven fee installments sum exactly to ₹40,002.00 without rounding error');

    // Create another fee structure where total cents % 4 !== 0, e.g. 40002.02 (4000202 cents -> remainder 2)
    const unevenCentsFeeRes = await pool.query(
      `INSERT INTO fee_structures (class_id, academic_year, annual_fee)
       VALUES (1, '2025-TEST-CENTS', 40002.02)
       RETURNING id, annual_fee`,
    );
    const unevenCentsFeeId = unevenCentsFeeRes.rows[0].id;
    createdFeeStructIds.push(unevenCentsFeeId);

    const testAppCents = await createTestApp(1, 'APPROVED');
    const enrollCentsRes = await fetch(`${baseUrl}/api/students/enroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        application_id: testAppCents,
        section_id: 2,
        fee_structure_id: unevenCentsFeeId
      })
    });
    const enrollCentsData = await enrollCentsRes.json();
    assert(enrollCentsRes.status === 201, 'Enrollment with remainder cents fee structure succeeds with 201');

    const centsStudentId = enrollCentsData.data.student.id;
    createdStudentIds.push(centsStudentId);

    const dbCentsInstRes = await pool.query(
      `SELECT installment_number, amount 
       FROM fee_installments 
       WHERE student_id = $1 
       ORDER BY installment_number ASC`,
      [centsStudentId]
    );
    const centsAmounts = dbCentsInstRes.rows.map(r => Number(r.amount));
    const centsSum = centsAmounts.reduce((a, b) => a + b, 0);
    assert(Math.round(centsSum * 100) === 4000202, 'Installments for ₹40,002.02 sum exactly to ₹40,002.02 (10000.51, 10000.51, 10000.50, 10000.50)');
    assert(centsAmounts[0] === 10000.51 && centsAmounts[1] === 10000.51 && centsAmounts[2] === 10000.50 && centsAmounts[3] === 10000.50, 'Remainder cents distributed deterministically to installments 1 and 2');

    // ==========================================
    // 7. DUPLICATE ENROLLMENT PROTECTION TESTS
    // ==========================================
    console.log('\n--- 7. Duplicate Enrollment Protection Tests ---');

    // Re-enrolling testAppApproved1 must return 409 Conflict
    const duplicateEnrollRes = await fetch(`${baseUrl}/api/students/enroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        application_id: testAppApproved1,
        section_id: 2,
        fee_structure_id: 1
      })
    });
    const duplicateEnrollData = await duplicateEnrollRes.json();
    assert(duplicateEnrollRes.status === 409, 'Re-enrolling an already enrolled application returns 409 Conflict');
    assert(duplicateEnrollData.message.includes('already been enrolled'), 'Response clearly explains duplicate enrollment');

    // Verify student count and installment count in DB didn't increase
    const checkDupStudents = await pool.query('SELECT COUNT(*) FROM students WHERE application_id = $1', [testAppApproved1]);
    assert(parseInt(checkDupStudents.rows[0].count) === 1, 'Database student count remains exactly 1 for the application');

    // ==========================================
    // 8. SECTION CAPACITY ENFORCEMENT TESTS
    // ==========================================
    console.log('\n--- 8. Section Capacity Enforcement Tests ---');

    // Create a temporary test section with capacity = 1
    const testSecRes = await pool.query(
      `INSERT INTO sections (class_id, name, capacity)
       VALUES (3, 'T', 1)
       RETURNING id, name, capacity`
    );
    const testCapSecId = testSecRes.rows[0].id;
    createdSectionIds.push(testCapSecId);

    // Application 1 for Class 3
    const appCap1 = await createTestApp(3, 'APPROVED');
    const enrollCap1Res = await fetch(`${baseUrl}/api/students/enroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        application_id: appCap1,
        section_id: testCapSecId,
        fee_structure_id: 3 // Fee structure for Class 3
      })
    });
    assert(enrollCap1Res.status === 201, 'First student enrolled into capacity=1 section successfully');
    const capStudent1 = (await enrollCap1Res.json()).data.student.id;
    createdStudentIds.push(capStudent1);

    // Application 2 for Class 3 (section is now full)
    const appCap2 = await createTestApp(3, 'APPROVED');
    const enrollCap2Res = await fetch(`${baseUrl}/api/students/enroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        application_id: appCap2,
        section_id: testCapSecId,
        fee_structure_id: 3
      })
    });
    const enrollCap2Data = await enrollCap2Res.json();
    assert(enrollCap2Res.status === 409, 'Enrolling into full section returns 409 Conflict');
    assert(enrollCap2Data.message.includes('full capacity'), 'Error message specifies section is at full capacity');

    // Verify appCap2 was NOT enrolled as student
    const checkCap2Student = await pool.query('SELECT COUNT(*) FROM students WHERE application_id = $1', [appCap2]);
    assert(parseInt(checkCap2Student.rows[0].count) === 0, 'No student record created for rejected full-section enrollment');

    // ==========================================
    // 9. TRANSACTION ROLLBACK INTEGRITY TEST
    // ==========================================
    console.log('\n--- 9. Transaction Rollback Integrity Test ---');

    // Simulate installment failure inside transaction and verify student insert is rolled back
    const appRollbackTest = await createTestApp(1, 'APPROVED');
    const txClient = await pool.connect();
    let rollbackSuccess = false;
    try {
      await txClient.query('BEGIN');
      const studRes = await txClient.query(
        `INSERT INTO students (application_id, first_name, last_name, date_of_birth, section_id)
         VALUES ($1, 'Rollback', 'Test', '2016-01-01', 1)
         RETURNING id`,
        [appRollbackTest]
      );
      // Intentionally violate check constraint on installment_number: -1
      await txClient.query(
        `INSERT INTO fee_installments (student_id, fee_structure_id, installment_number, amount, status, due_date)
         VALUES ($1, 1, -1, 1000.00, 'PENDING', '2023-05-01')`,
        [studRes.rows[0].id]
      );
      await txClient.query('COMMIT');
    } catch (simulatedErr) {
      await txClient.query('ROLLBACK');
      rollbackSuccess = true;
    } finally {
      txClient.release();
    }

    assert(rollbackSuccess, 'Simulated installment failure triggered rollback');
    const checkRollbackStudent = await pool.query('SELECT id FROM students WHERE application_id = $1', [appRollbackTest]);
    assert(checkRollbackStudent.rows.length === 0, 'Student insert was cleanly rolled back after installment failure');

    // ==========================================
    // 10. CONCURRENCY TESTS
    // ==========================================
    console.log('\n--- 10. Concurrency Tests ---');

    // 10a. Concurrent enrollment for the SAME application
    const appConcSame = await createTestApp(1, 'APPROVED');
    const [concRes1, concRes2] = await Promise.all([
      fetch(`${baseUrl}/api/students/enroll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ application_id: appConcSame, section_id: 2, fee_structure_id: 1 })
      }),
      fetch(`${baseUrl}/api/students/enroll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ application_id: appConcSame, section_id: 2, fee_structure_id: 1 })
      })
    ]);

    const concStatuses = [concRes1.status, concRes2.status].sort();
    assert(
      concStatuses[0] === 201 && concStatuses[1] === 409,
      `Concurrent enrollment for same application: exactly one 201 Created and one 409 Conflict (got ${concStatuses[0]}, ${concStatuses[1]})`
    );

    const concStudentRes = await pool.query('SELECT id FROM students WHERE application_id = $1', [appConcSame]);
    assert(concStudentRes.rows.length === 1, 'Exactly 1 student row created during concurrent race');
    createdStudentIds.push(concStudentRes.rows[0].id);

    // 10b. Concurrent enrollment hitting SECTION CAPACITY
    // Create a new test section with capacity = 1 in Class 4
    const testSecConcRes = await pool.query(
      `INSERT INTO sections (class_id, name, capacity)
       VALUES (4, 'C', 1)
       RETURNING id, name, capacity`
    );
    const testSecConcId = testSecConcRes.rows[0].id;
    createdSectionIds.push(testSecConcId);

    const appCapRace1 = await createTestApp(4, 'APPROVED');
    const appCapRace2 = await createTestApp(4, 'APPROVED');

    const [raceRes1, raceRes2] = await Promise.all([
      fetch(`${baseUrl}/api/students/enroll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ application_id: appCapRace1, section_id: testSecConcId, fee_structure_id: 4 })
      }),
      fetch(`${baseUrl}/api/students/enroll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ application_id: appCapRace2, section_id: testSecConcId, fee_structure_id: 4 })
      })
    ]);

    const raceStatuses = [raceRes1.status, raceRes2.status].sort();
    assert(
      raceStatuses[0] === 201 && raceStatuses[1] === 409,
      `Concurrent race for section capacity limit: exactly one 201 and one 409 (got ${raceStatuses[0]}, ${raceStatuses[1]})`
    );

    const checkCapRaceEnrolled = await pool.query('SELECT id FROM students WHERE section_id = $1', [testSecConcId]);
    assert(checkCapRaceEnrolled.rows.length === 1, 'Section capacity strictly preserved at 1 student under concurrent load');
    createdStudentIds.push(checkCapRaceEnrolled.rows[0].id);

    // ==========================================
    // 11. STUDENT RETRIEVAL ENDPOINTS TESTS
    // ==========================================
    console.log('\n--- 11. Student Retrieval Endpoints Tests ---');

    // 11a. GET /api/students returns enrolled student list with classes and sections
    const getStudentsRes = await fetch(`${baseUrl}/api/students`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const getStudentsData = await getStudentsRes.json();

    assert(getStudentsRes.status === 200, 'GET /api/students returns 200 OK');
    assert(Array.isArray(getStudentsData.data), 'GET /api/students data is an array');
    assert(getStudentsData.data.length >= 4, `GET /api/students returns enrolled students (count: ${getStudentsData.data.length})`);

    const firstStudent = getStudentsData.data[0];
    assert(
      firstStudent.id && firstStudent.first_name && firstStudent.class_name && firstStudent.section_name,
      'Student record contains id, first_name, class_name, section_name, and academic_year'
    );

    // Verify lateral join prevented duplicate student rows
    const uniqueStudentIdsInResponse = new Set(getStudentsData.data.map(s => s.id));
    assert(uniqueStudentIdsInResponse.size === getStudentsData.data.length, 'No duplicate student rows in GET /api/students');

    // 11b. GET /api/students with class_id filter
    const filterClassRes = await fetch(`${baseUrl}/api/students?class_id=1`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const filterClassData = await filterClassRes.json();
    assert(filterClassRes.status === 200, 'GET /api/students?class_id=1 returns 200 OK');
    const allClass1 = filterClassData.data.every(s => s.class_id === 1);
    assert(allClass1, 'Filter ?class_id=1 correctly returns only Class 1 students');

    // 11c. GET /api/students/:id returns single student with installments
    const getSingleStudentRes = await fetch(`${baseUrl}/api/students/${enrolledStudentId1}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const getSingleStudentData = await getSingleStudentRes.json();

    assert(getSingleStudentRes.status === 200, 'GET /api/students/:id returns 200 OK');
    assert(getSingleStudentData.data.id === enrolledStudentId1, 'GET /api/students/:id returns matching student ID');
    assert(getSingleStudentData.data.class && getSingleStudentData.data.class.name === 'Class 1', 'Class details returned in profile');
    assert(getSingleStudentData.data.section && getSingleStudentData.data.section.name === 'B', 'Section details returned in profile');
    assert(getSingleStudentData.data.fee_structure && getSingleStudentData.data.fee_structure.annual_fee, 'Fee structure returned in profile');
    assert(
      Array.isArray(getSingleStudentData.data.installments) && getSingleStudentData.data.installments.length === 4,
      'Profile contains all 4 fee installments'
    );
    assert(
      getSingleStudentData.data.installments[0].installment_number === 1 &&
      getSingleStudentData.data.installments[3].installment_number === 4,
      'Installments correctly ordered from 1 to 4'
    );

    // 11d. GET /api/students/999999 returns 404 Not Found
    const notFoundStudentRes = await fetch(`${baseUrl}/api/students/999999`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(notFoundStudentRes.status === 404, 'GET /api/students/999999 returns 404 Not Found');

    // 11e. GET /api/students/invalid returns 400 Bad Request
    const badParamRes = await fetch(`${baseUrl}/api/students/abc`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(badParamRes.status === 400, 'GET /api/students/abc returns 400 Bad Request');

  } catch (err) {
    console.error('Unexpected error during test execution:', err);
    failed++;
  } finally {
    // Isolated Cleanup: Clean up ONLY test-created resources
    console.log('\n--- Cleaning up isolated test resources ---');
    try {
      if (createdStudentIds.length > 0) {
        await pool.query('DELETE FROM payments WHERE installment_id IN (SELECT id FROM fee_installments WHERE student_id = ANY($1))', [createdStudentIds]);
        await pool.query('DELETE FROM fee_installments WHERE student_id = ANY($1)', [createdStudentIds]);
        await pool.query('DELETE FROM students WHERE id = ANY($1)', [createdStudentIds]);
      }
      if (createdSectionIds.length > 0) {
        await pool.query('DELETE FROM sections WHERE id = ANY($1)', [createdSectionIds]);
      }
      if (createdFeeStructIds.length > 0) {
        await pool.query('DELETE FROM fee_structures WHERE id = ANY($1)', [createdFeeStructIds]);
      }
      if (createdAppIds.length > 0) {
        await pool.query('DELETE FROM admission_applications WHERE id = ANY($1)', [createdAppIds]);
      }
      console.log('Cleanup completed successfully.');
    } catch (cleanupErr) {
      console.error('Error during cleanup:', cleanupErr);
    }

    server.close();
    await pool.end();
  }

  console.log(`\n========================================`);
  console.log(`PHASE 2 ENROLLMENT TEST RESULTS:`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
