require('dotenv').config();
const http = require('http');
const app = require('../app');
const pool = require('../config/db');
const emailService = require('../services/email.service');

async function runTests() {
  console.log('--- STARTING PHASE 1: ADMISSION APPLICATIONS TESTS ---');

  const PORT = 5097;
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(PORT, resolve));
  const baseUrl = `http://localhost:${PORT}`;

  let passed = 0;
  let failed = 0;
  const createdTestAppIds = [];

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

    // 1. Role-based protection tests
    // 1a. Unauthenticated access rejected with 401
    const unauthRes = await fetch(`${baseUrl}/api/admissions`);
    assert(unauthRes.status === 401, 'GET /api/admissions without token returns 401 Unauthorized');

    // 1b. Teacher access rejected with 403 Forbidden
    const teacherGetRes = await fetch(`${baseUrl}/api/admissions`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    assert(teacherGetRes.status === 403, 'GET /api/admissions with teacher token returns 403 Forbidden');

    const teacherPostRes = await fetch(`${baseUrl}/api/admissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({
        student_first_name: 'Test',
        student_last_name: 'Student',
        date_of_birth: '2016-01-01',
        target_class_id: 1,
        parent_name: 'Parent Name',
        parent_email: 'parent@test.com',
        parent_phone: '1234567890'
      })
    });
    assert(teacherPostRes.status === 403, 'POST /api/admissions with teacher token returns 403 Forbidden');

    const teacherPatchRes = await fetch(`${baseUrl}/api/admissions/1/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({ status: 'APPROVED' })
    });
    assert(teacherPatchRes.status === 403, 'PATCH /api/admissions/:id/status with teacher token returns 403 Forbidden');

    // 2. Input validation failures for POST /api/admissions
    // 2a. Missing student name
    const missingNameRes = await fetch(`${baseUrl}/api/admissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        student_first_name: '',
        student_last_name: 'Student',
        date_of_birth: '2016-01-01',
        target_class_id: 1,
        parent_name: 'Parent',
        parent_email: 'parent@domain.com',
        parent_phone: '1234567890'
      })
    });
    assert(missingNameRes.status === 400, 'POST /api/admissions with empty student name returns 400 Bad Request');

    // 2b. Missing parent contact
    const missingParentRes = await fetch(`${baseUrl}/api/admissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        student_first_name: 'Alice',
        student_last_name: 'Smith',
        date_of_birth: '2016-01-01',
        target_class_id: 1,
        parent_name: '',
        parent_email: 'parent@domain.com',
        parent_phone: ''
      })
    });
    assert(missingParentRes.status === 400, 'POST /api/admissions with missing parent details returns 400 Bad Request');

    // 2c. Invalid parent email format
    const invalidEmailRes = await fetch(`${baseUrl}/api/admissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        student_first_name: 'Alice',
        student_last_name: 'Smith',
        date_of_birth: '2016-01-01',
        target_class_id: 1,
        parent_name: 'Bob Smith',
        parent_email: 'not-an-email',
        parent_phone: '9876543210'
      })
    });
    assert(invalidEmailRes.status === 400, 'POST /api/admissions with invalid email returns 400 Bad Request');

    // 2c-2. Malformed email with numeric TLD (e.g. nandev160@gmail.com145)
    const numericTldRes = await fetch(`${baseUrl}/api/admissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        student_first_name: 'Alice',
        student_last_name: 'Smith',
        date_of_birth: '2016-01-01',
        target_class_id: 1,
        parent_name: 'Bob Smith',
        parent_email: 'nandev160@gmail.com145',
        parent_phone: '9876543210'
      })
    });
    assert(numericTldRes.status === 400, 'POST /api/admissions with numeric TLD (.com145) returns 400 Bad Request');

    // 2c-2b. Exact failing typo: nandev160@gmail.comm (rejected with 400 and helpful typo error message)
    const typoCommRes = await fetch(`${baseUrl}/api/admissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        student_first_name: 'TestFailingInput',
        student_last_name: 'CommTypo',
        date_of_birth: '2016-01-01',
        target_class_id: 1,
        parent_name: 'Bob Smith',
        parent_email: 'nandev160@gmail.comm',
        parent_phone: '9876543210'
      })
    });
    const typoCommData = await typoCommRes.json();
    assert(
      typoCommRes.status === 400 && typoCommData.message && typoCommData.message.includes('typo'),
      `POST /api/admissions rejects exact failing input "nandev160@gmail.comm" with 400 Bad Request and typo warning (message: "${typoCommData.message}")`
    );

    // Verify nandev160@gmail.comm was NOT inserted into PostgreSQL
    const checkDbNoInsert = await pool.query(
      "SELECT id FROM admission_applications WHERE parent_email = 'nandev160@gmail.comm' AND student_first_name = 'TestFailingInput'"
    );
    assert(
      checkDbNoInsert.rows.length === 0,
      'Confirmed invalid email submission creates zero rows in PostgreSQL admission_applications'
    );

    // 2c-2c. Common TLD typo: .cmo (e.g. parent@example.cmo)
    const typoCmoRes = await fetch(`${baseUrl}/api/admissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        student_first_name: 'Alice',
        student_last_name: 'Smith',
        date_of_birth: '2016-01-01',
        target_class_id: 1,
        parent_name: 'Bob Smith',
        parent_email: 'parent@example.cmo',
        parent_phone: '9876543210'
      })
    });
    assert(typoCmoRes.status === 400, 'POST /api/admissions rejects .cmo typo with 400 Bad Request');

    // 2c-2d. Common TLD typo: .con (e.g. parent@example.con)
    const typoConRes = await fetch(`${baseUrl}/api/admissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        student_first_name: 'Alice',
        student_last_name: 'Smith',
        date_of_birth: '2016-01-01',
        target_class_id: 1,
        parent_name: 'Bob Smith',
        parent_email: 'parent@example.con',
        parent_phone: '9876543210'
      })
    });
    assert(typoConRes.status === 400, 'POST /api/admissions rejects .con typo with 400 Bad Request');

    // 2c-2e. Common webmail domain typo: @gamil.com
    const typoGamilRes = await fetch(`${baseUrl}/api/admissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        student_first_name: 'Alice',
        student_last_name: 'Smith',
        date_of_birth: '2016-01-01',
        target_class_id: 1,
        parent_name: 'Bob Smith',
        parent_email: 'parent@gamil.com',
        parent_phone: '9876543210'
      })
    });
    assert(typoGamilRes.status === 400, 'POST /api/admissions rejects @gamil.com typo with 400 Bad Request');

    // 2c-3. Phone number containing letters (e.g. 98986545fgggg)
    const lettersPhoneRes = await fetch(`${baseUrl}/api/admissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        student_first_name: 'Alice',
        student_last_name: 'Smith',
        date_of_birth: '2016-01-01',
        target_class_id: 1,
        parent_name: 'Bob Smith',
        parent_email: 'parent@domain.com',
        parent_phone: '98986545fgggg'
      })
    });
    assert(lettersPhoneRes.status === 400, 'POST /api/admissions with letters in phone returns 400 Bad Request');

    // 2c-4. Phone number with non-Indian starting digit (e.g. 1234567890 or 555-0199)
    const nonIndianPhoneRes = await fetch(`${baseUrl}/api/admissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        student_first_name: 'Alice',
        student_last_name: 'Smith',
        date_of_birth: '2016-01-01',
        target_class_id: 1,
        parent_name: 'Bob Smith',
        parent_email: 'parent@domain.com',
        parent_phone: '1234567890'
      })
    });
    assert(nonIndianPhoneRes.status === 400, 'POST /api/admissions with non-Indian starting digit (1-5) returns 400 Bad Request');

    // 2c-5. Phone number with short length (e.g. 98765)
    const shortPhoneRes = await fetch(`${baseUrl}/api/admissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        student_first_name: 'Alice',
        student_last_name: 'Smith',
        date_of_birth: '2016-01-01',
        target_class_id: 1,
        parent_name: 'Bob Smith',
        parent_email: 'parent@domain.com',
        parent_phone: '98765'
      })
    });
    assert(shortPhoneRes.status === 400, 'POST /api/admissions with short phone number returns 400 Bad Request');

    // 2d. Future date of birth
    const futureDobRes = await fetch(`${baseUrl}/api/admissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        student_first_name: 'Alice',
        student_last_name: 'Smith',
        date_of_birth: '2099-01-01',
        target_class_id: 1,
        parent_name: 'Bob Smith',
        parent_email: 'bob@domain.com',
        parent_phone: '9876543210'
      })
    });
    assert(futureDobRes.status === 400, 'POST /api/admissions with future date of birth returns 400 Bad Request');

    // 2e. Non-existent target class
    const badClassRes = await fetch(`${baseUrl}/api/admissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        student_first_name: 'Alice',
        student_last_name: 'Smith',
        date_of_birth: '2016-01-01',
        target_class_id: 9999,
        parent_name: 'Bob Smith',
        parent_email: 'bob@domain.com',
        parent_phone: '9876543210'
      })
    });
    assert(badClassRes.status === 404, 'POST /api/admissions with non-existent target_class_id returns 404 Not Found');

    // 3. Valid admission creation (with synthetic @example.com email for suppression testing)
    const createSyntheticRes = await fetch(`${baseUrl}/api/admissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        student_first_name: 'TestChild1',
        student_last_name: 'SyntheticFamily',
        date_of_birth: '2016-06-15',
        target_class_id: 1,
        parent_name: 'Parent Synthetic',
        parent_email: 'parent.synthetic@example.com',
        parent_phone: '9876543211'
      })
    });
    const createSyntheticData = await createSyntheticRes.json();
    assert(
      createSyntheticRes.status === 201 &&
      createSyntheticData.success === true &&
      createSyntheticData.data.status === 'PENDING' &&
      createSyntheticData.data.parent_email === 'parent.synthetic@example.com',
      'POST /api/admissions creates application with status PENDING and 201 Created'
    );
    const syntheticAppId = createSyntheticData.data?.id;
    if (syntheticAppId) createdTestAppIds.push(syntheticAppId);

    // 4. Valid admission creation (with legitimate domain for simulation testing)
    const createLegitRes = await fetch(`${baseUrl}/api/admissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        student_first_name: 'TestChild2',
        student_last_name: 'LegitFamily',
        date_of_birth: '2017-02-20',
        target_class_id: 2,
        parent_name: 'Parent Legit',
        parent_email: 'parent.legit@myrealschooltest.org',
        parent_phone: '+91 98765 43212'
      })
    });
    const createLegitData = await createLegitRes.json();
    assert(
      createLegitRes.status === 201 &&
      createLegitData.success === true &&
      createLegitData.data.status === 'PENDING',
      'POST /api/admissions creates second application with legitimate email'
    );
    const legitAppId = createLegitData.data?.id;
    if (legitAppId) createdTestAppIds.push(legitAppId);

    // 5. Listing and filtering
    // 5a. List all
    const listAllRes = await fetch(`${baseUrl}/api/admissions`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const listAllData = await listAllRes.json();
    assert(
      listAllRes.status === 200 &&
      listAllData.success === true &&
      Array.isArray(listAllData.data) &&
      listAllData.data.length >= 12,
      `GET /api/admissions returns 200 and list of applications (count: ${listAllData.data?.length})`
    );

    // 5b. Filter by status PENDING
    const listPendingRes = await fetch(`${baseUrl}/api/admissions?status=PENDING`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const listPendingData = await listPendingRes.json();
    const allArePending = listPendingData.data.every(a => a.status === 'PENDING');
    assert(
      listPendingRes.status === 200 &&
      allArePending &&
      listPendingData.data.length >= 2,
      `GET /api/admissions?status=PENDING returns only PENDING applications (count: ${listPendingData.data?.length})`
    );

    // 5c. Invalid status filter returns 400
    const badFilterRes = await fetch(`${baseUrl}/api/admissions?status=INVALID_STATUS`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(badFilterRes.status === 400, 'GET /api/admissions?status=INVALID_STATUS returns 400 Bad Request');

    // 6. Single-record retrieval
    // 6a. Valid ID
    const getSingleRes = await fetch(`${baseUrl}/api/admissions/${syntheticAppId}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const getSingleData = await getSingleRes.json();
    assert(
      getSingleRes.status === 200 &&
      getSingleData.data.id === syntheticAppId &&
      getSingleData.data.target_class_name === 'Class 1',
      'GET /api/admissions/:id returns single application with joined class name'
    );

    // 6b. Non-existent ID returns 404
    const notFoundRes = await fetch(`${baseUrl}/api/admissions/999999`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(notFoundRes.status === 404, 'GET /api/admissions/999999 returns 404 Not Found');

    // 6c. Invalid ID parameter returns 400
    const badIdRes = await fetch(`${baseUrl}/api/admissions/abc`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(badIdRes.status === 400, 'GET /api/admissions/abc returns 400 Bad Request');

    // 7. Status decisions & Email behavior
    // 7a. Invalid status decision returns 400
    const badDecisionRes = await fetch(`${baseUrl}/api/admissions/${syntheticAppId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ status: 'MAYBE' })
    });
    assert(badDecisionRes.status === 400, 'PATCH /api/admissions/:id/status with status=MAYBE returns 400 Bad Request');

    // 7b. Decision on synthetic contact: status APPROVED, email suppressed
    const approveSyntheticRes = await fetch(`${baseUrl}/api/admissions/${syntheticAppId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ status: 'APPROVED' })
    });
    const approveSyntheticData = await approveSyntheticRes.json();
    assert(
      approveSyntheticRes.status === 200 &&
      approveSyntheticData.data.status === 'APPROVED' &&
      approveSyntheticData.notification.sent === false &&
      approveSyntheticData.notification.mode === 'suppressed' &&
      approveSyntheticData.notification.reason === 'synthetic_example_domain',
      'Approving synthetic contact suppresses email (mode: suppressed, reason: synthetic_example_domain)'
    );

    // 7c. Repeated decision on already APPROVED application returns 409 Conflict
    const repeatDecisionRes = await fetch(`${baseUrl}/api/admissions/${syntheticAppId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ status: 'APPROVED' })
    });
    assert(repeatDecisionRes.status === 409, 'Repeated decision on already APPROVED application returns 409 Conflict');

    const switchDecisionRes = await fetch(`${baseUrl}/api/admissions/${syntheticAppId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ status: 'REJECTED' })
    });
    assert(switchDecisionRes.status === 409, 'Changing already APPROVED application to REJECTED returns 409 Conflict');

    // 7d. Decision on legitimate contact when SMTP is unconfigured returns mode: 'simulated'
    const rejectLegitRes = await fetch(`${baseUrl}/api/admissions/${legitAppId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ status: 'REJECTED' })
    });
    const rejectLegitData = await rejectLegitRes.json();
    assert(
      rejectLegitRes.status === 200 &&
      rejectLegitData.data.status === 'REJECTED' &&
      (
        (rejectLegitData.notification.sent === false && rejectLegitData.notification.mode === 'simulated') ||
        (rejectLegitData.notification.sent === true && rejectLegitData.notification.mode === 'delivered')
      ),
      'Deciding legitimate contact executes properly via either simulated or delivered SMTP mode'
    );

    // 8. Concurrent status decision race condition protection
    // Create a 3rd test application specifically for concurrent race condition testing
    const createRaceRes = await fetch(`${baseUrl}/api/admissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        student_first_name: 'RaceChild',
        student_last_name: 'ConcurrentTest',
        date_of_birth: '2016-03-10',
        target_class_id: 3,
        parent_name: 'Race Parent',
        parent_email: 'race.parent@example.com',
        parent_phone: '9876543213'
      })
    });
    const createRaceData = await createRaceRes.json();
    const raceAppId = createRaceData.data?.id;
    if (raceAppId) createdTestAppIds.push(raceAppId);

    // Fire two simultaneous decision requests
    const [raceRes1, raceRes2] = await Promise.all([
      fetch(`${baseUrl}/api/admissions/${raceAppId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ status: 'APPROVED' })
      }),
      fetch(`${baseUrl}/api/admissions/${raceAppId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ status: 'REJECTED' })
      })
    ]);

    const raceStatuses = [raceRes1.status, raceRes2.status].sort();
    assert(
      raceStatuses[0] === 200 && raceStatuses[1] === 409,
      `Concurrent decision race condition resolved safely: exactly one 200 OK and one 409 Conflict (got ${raceStatuses[0]}, ${raceStatuses[1]})`
    );

    // 9. Email service unit tests
    // 9a. Invalid recipient format skipped
    const invalidEmailResult = await emailService.sendDecisionEmail({
      recipientEmail: 'invalid-email-string',
      studentName: 'Test Student',
      status: 'APPROVED'
    });
    assert(
      invalidEmailResult.sent === false && invalidEmailResult.mode === 'skipped',
      'emailService skips delivery for invalid email format'
    );

    // 9b. Synthetic subdomains suppressed
    const subDomainResult = await emailService.sendDecisionEmail({
      recipientEmail: 'parent@mail.example.com',
      studentName: 'Test Student',
      status: 'APPROVED'
    });
    assert(
      subDomainResult.sent === false && subDomainResult.mode === 'suppressed',
      'emailService suppresses subdomains of example.com'
    );

    // 9c. SMTP failure resilience test (mocking transporter error)
    const originalHost = process.env.SMTP_HOST;
    const originalUser = process.env.SMTP_USER;
    const originalPass = process.env.SMTP_PASS;

    // Set invalid dummy SMTP credentials to trigger delivery failure
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = '2525';
    process.env.SMTP_USER = 'test_user';
    process.env.SMTP_PASS = 'test_pass';

    const failEmailResult = await emailService.sendDecisionEmail({
      recipientEmail: 'legitimate.parent@actualdomain.org',
      recipientName: 'Real Parent',
      studentName: 'Real Student',
      status: 'APPROVED'
    });

    assert(
      failEmailResult.sent === false &&
      failEmailResult.mode === 'failed' &&
      typeof failEmailResult.error === 'string' &&
      !failEmailResult.error.includes('test_pass'), // Ensures passwords are never leaked
      'emailService handles SMTP delivery failure gracefully without exposing credentials'
    );

    // Restore environment
    process.env.SMTP_HOST = originalHost;
    process.env.SMTP_USER = originalUser;
    process.env.SMTP_PASS = originalPass;

    // 10. Verify no students or fee installments were created by Phase 1
    const { rows: studentCheck } = await pool.query(
      'SELECT id FROM students WHERE application_id = ANY($1)',
      [createdTestAppIds]
    );
    assert(studentCheck.length === 0, 'Confirmed NO student records were created by admission decision requests');

  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    // Clean up test records created during this run
    if (createdTestAppIds.length > 0) {
      await pool.query('DELETE FROM admission_applications WHERE id = ANY($1)', [createdTestAppIds]);
      console.log(`Cleaned up ${createdTestAppIds.length} test admission applications.`);
    }

    server.close();
    await pool.end();
    console.log(`\n========================================`);
    console.log(`PHASE 1 TESTS COMPLETE: ${passed} passed, ${failed} failed`);
    console.log(`========================================`);
    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests();
