require('dotenv').config();
const http = require('http');
const app = require('../app');
const pool = require('../config/db');

async function runTests() {
  console.log('--- STARTING FEE STRUCTURES & PAYMENTS INTEGRATION TESTS ---');

  const PORT = 5095;
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(PORT, resolve));
  const baseUrl = `http://localhost:${PORT}`;

  let passed = 0;
  let failed = 0;

  // Track all test-created resources for isolated cleanup
  const createdPaymentIds = [];
  const createdStudentIds = [];
  const createdFeeStructIds = [];
  const createdAppIds = [];

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
    // 0. Login as Admin and Teacher
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
    // 1. FEE STRUCTURES AUTHENTICATION & AUTHORIZATION
    // ==========================================
    console.log('\n--- 1. Fee Structures Auth Tests ---');
    const unauthFsRes = await fetch(`${baseUrl}/api/fee-structures`);
    assert(unauthFsRes.status === 401, 'GET /api/fee-structures without token returns 401 Unauthorized');

    const teacherFsRes = await fetch(`${baseUrl}/api/fee-structures`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    assert(teacherFsRes.status === 403, 'GET /api/fee-structures with teacher token returns 403 Forbidden');

    const teacherFsPostRes = await fetch(`${baseUrl}/api/fee-structures`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({ class_id: 1, academic_year: '2027-2028', annual_fee: 30000 })
    });
    assert(teacherFsPostRes.status === 403, 'POST /api/fee-structures with teacher token returns 403 Forbidden');

    const teacherFsPutRes = await fetch(`${baseUrl}/api/fee-structures/1`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({ annual_fee: 35000 })
    });
    assert(teacherFsPutRes.status === 403, 'PUT /api/fee-structures/:id with teacher token returns 403 Forbidden');

    // ==========================================
    // 2. FEE STRUCTURES LISTING & FILTERING
    // ==========================================
    console.log('\n--- 2. Fee Structures Listing & Filtering ---');
    const listFsRes = await fetch(`${baseUrl}/api/fee-structures`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const listFsData = await listFsRes.json();
    assert(
      listFsRes.status === 200 && listFsData.success === true && Array.isArray(listFsData.data),
      `GET /api/fee-structures returns 200 and fee structures list (found: ${listFsData.data?.length})`
    );

    const filterClassRes = await fetch(`${baseUrl}/api/fee-structures?class_id=1`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const filterClassData = await filterClassRes.json();
    assert(
      filterClassRes.status === 200 &&
      filterClassData.data.every(fs => fs.class_id === 1),
      'GET /api/fee-structures?class_id=1 returns only Class 1 structures'
    );

    const filterYearRes = await fetch(`${baseUrl}/api/fee-structures?academic_year=2024-2025`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const filterYearData = await filterYearRes.json();
    assert(
      filterYearRes.status === 200 &&
      filterYearData.data.every(fs => fs.academic_year === '2024-2025'),
      'GET /api/fee-structures?academic_year=2024-2025 returns only matching academic year'
    );

    const badFilterRes = await fetch(`${baseUrl}/api/fee-structures?class_id=abc`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(badFilterRes.status === 400, 'GET /api/fee-structures?class_id=abc returns 400 Bad Request');

    // ==========================================
    // 3. FEE STRUCTURES CREATION & VALIDATION
    // ==========================================
    console.log('\n--- 3. Fee Structures Creation Validation ---');
    const missingFieldsRes = await fetch(`${baseUrl}/api/fee-structures`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({})
    });
    assert(missingFieldsRes.status === 400, 'POST /api/fee-structures with missing body returns 400');

    const invalidClassRes = await fetch(`${baseUrl}/api/fee-structures`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ class_id: 'bad', academic_year: '2028-2029', annual_fee: 30000 })
    });
    assert(invalidClassRes.status === 400, 'POST /api/fee-structures with invalid class_id returns 400');

    const notFoundClassRes = await fetch(`${baseUrl}/api/fee-structures`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ class_id: 99999, academic_year: '2028-2029', annual_fee: 30000 })
    });
    assert(notFoundClassRes.status === 404, 'POST /api/fee-structures with nonexistent class_id returns 404');

    const badYearRes = await fetch(`${baseUrl}/api/fee-structures`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ class_id: 1, academic_year: '2028/29', annual_fee: 30000 })
    });
    assert(badYearRes.status === 400, 'POST /api/fee-structures with malformed academic_year returns 400');

    const badFeeRes = await fetch(`${baseUrl}/api/fee-structures`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ class_id: 1, academic_year: '2028-2029', annual_fee: -500 })
    });
    assert(badFeeRes.status === 400, 'POST /api/fee-structures with negative annual_fee returns 400');

    // Valid creation
    const validFsRes = await fetch(`${baseUrl}/api/fee-structures`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ class_id: 1, academic_year: '2028-2029', annual_fee: 35000 })
    });
    const validFsData = await validFsRes.json();
    assert(
      validFsRes.status === 201 && validFsData.success === true && validFsData.data.annual_fee === '35000.00',
      'POST /api/fee-structures creates new fee structure with 201 Created'
    );
    if (validFsData.data?.id) {
      createdFeeStructIds.push(validFsData.data.id);
    }
    const testFsId = validFsData.data?.id;

    // Duplicate creation
    const dupFsRes = await fetch(`${baseUrl}/api/fee-structures`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ class_id: 1, academic_year: '2028-2029', annual_fee: 40000 })
    });
    assert(dupFsRes.status === 409, 'POST /api/fee-structures duplicate (class_id, academic_year) returns 409 Conflict');

    // ==========================================
    // 4. FEE STRUCTURE UPDATE & HISTORICAL INTEGRITY
    // ==========================================
    console.log('\n--- 4. Fee Structures Update & Historical Integrity ---');
    const notFoundPutRes = await fetch(`${baseUrl}/api/fee-structures/999999`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ annual_fee: 40000 })
    });
    assert(notFoundPutRes.status === 404, 'PUT /api/fee-structures/999999 returns 404 Not Found');

    const badIdPutRes = await fetch(`${baseUrl}/api/fee-structures/invalid_id`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ annual_fee: 40000 })
    });
    assert(badIdPutRes.status === 400, 'PUT /api/fee-structures/invalid_id returns 400 Bad Request');

    const badFeePutRes = await fetch(`${baseUrl}/api/fee-structures/${testFsId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ annual_fee: 0 })
    });
    assert(badFeePutRes.status === 400, 'PUT /api/fee-structures/:id with zero annual_fee returns 400');

    // Create a student enrolled with this fee structure to verify historical installments preservation
    const appRes = await pool.query(`
      INSERT INTO admission_applications (
        student_first_name, student_last_name, date_of_birth, target_class_id, status, parent_name, parent_email, parent_phone
      ) VALUES ('HistTest', 'Student', '2018-05-10', 1, 'APPROVED', 'Parent Hist', 'hist.parent@example.com', '555-9988')
      RETURNING id
    `);
    const appId = appRes.rows[0].id;
    createdAppIds.push(appId);

    const enrollRes = await fetch(`${baseUrl}/api/students/enroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        application_id: appId,
        section_id: 1, // Class 1, Section A
        fee_structure_id: testFsId
      })
    });
    const enrollData = await enrollRes.json();
    assert(enrollRes.status === 201, 'Test student enrolled successfully under fee structure');
    const studentId = enrollData.data.student.id;
    createdStudentIds.push(studentId);

    // Initial installment amounts: 35000 / 4 = 8750.00 each
    const initialInstallments = enrollData.data.installments;
    assert(
      initialInstallments.length === 4 && initialInstallments.every(i => i.amount === '8750.00'),
      'Initial student installments created at ₹8750.00 each'
    );

    // Update fee structure annual_fee from 35000 to 48000
    const updateFsRes = await fetch(`${baseUrl}/api/fee-structures/${testFsId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ annual_fee: 48000 })
    });
    const updateFsData = await updateFsRes.json();
    assert(
      updateFsRes.status === 200 && updateFsData.data.annual_fee === '48000.00',
      'PUT /api/fee-structures/:id successfully updated annual_fee to ₹48,000.00'
    );

    // Verify student historical installments remain unchanged at 8750.00
    const checkInstRes = await pool.query(
      'SELECT installment_number, amount FROM fee_installments WHERE student_id = $1 ORDER BY installment_number',
      [studentId]
    );
    const unchanged = checkInstRes.rows.every(row => row.amount === '8750.00');
    assert(unchanged, 'Historical installments remain untouched at ₹8750.00 after fee structure update');

    // Attempt to modify class_id or academic_year on fee structure with active installments
    const modifyClassRes = await fetch(`${baseUrl}/api/fee-structures/${testFsId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ class_id: 2 })
    });
    assert(modifyClassRes.status === 409, 'Attempt to modify class_id on fee structure with installments returns 409 Conflict');

    // ==========================================
    // 5. PAYMENTS AUTHENTICATION & AUTHORIZATION
    // ==========================================
    console.log('\n--- 5. Payments Auth Tests ---');
    const testInstId1 = initialInstallments[0].id;
    const testInstId2 = initialInstallments[1].id;
    const testInstId3 = initialInstallments[2].id;

    const unauthPayRes = await fetch(`${baseUrl}/api/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installment_id: testInstId1, amount_paid: 8750, payment_method: 'UPI' })
    });
    assert(unauthPayRes.status === 401, 'POST /api/payments without token returns 401 Unauthorized');

    const teacherPayRes = await fetch(`${baseUrl}/api/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({ installment_id: testInstId1, amount_paid: 8750, payment_method: 'UPI' })
    });
    assert(teacherPayRes.status === 403, 'POST /api/payments with teacher token returns 403 Forbidden');

    const unauthGetPayRes = await fetch(`${baseUrl}/api/payments/1`);
    assert(unauthGetPayRes.status === 401, 'GET /api/payments/:id without token returns 401 Unauthorized');

    const teacherGetPayRes = await fetch(`${baseUrl}/api/payments/1`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    assert(teacherGetPayRes.status === 403, 'GET /api/payments/:id with teacher token returns 403 Forbidden');

    // ==========================================
    // 6. PAYMENTS VALIDATION & PARTIAL / OVERPAYMENT CHECKS
    // ==========================================
    console.log('\n--- 6. Payments Validation Tests ---');
    const missingBodyPayRes = await fetch(`${baseUrl}/api/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({})
    });
    assert(missingBodyPayRes.status === 400, 'POST /api/payments with empty body returns 400');

    const badInstIdPayRes = await fetch(`${baseUrl}/api/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ installment_id: 'bad', amount_paid: 8750, payment_method: 'UPI' })
    });
    assert(badInstIdPayRes.status === 400, 'POST /api/payments with invalid installment_id returns 400');

    const notFoundInstPayRes = await fetch(`${baseUrl}/api/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ installment_id: 999999, amount_paid: 8750, payment_method: 'UPI' })
    });
    assert(notFoundInstPayRes.status === 404, 'POST /api/payments with nonexistent installment_id returns 404');

    const zeroAmtPayRes = await fetch(`${baseUrl}/api/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ installment_id: testInstId1, amount_paid: 0, payment_method: 'UPI' })
    });
    assert(zeroAmtPayRes.status === 400, 'POST /api/payments with zero amount_paid returns 400');

    const negAmtPayRes = await fetch(`${baseUrl}/api/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ installment_id: testInstId1, amount_paid: -100, payment_method: 'UPI' })
    });
    assert(negAmtPayRes.status === 400, 'POST /api/payments with negative amount_paid returns 400');

    const boolAmtPayRes = await fetch(`${baseUrl}/api/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ installment_id: testInstId1, amount_paid: true, payment_method: 'UPI' })
    });
    assert(boolAmtPayRes.status === 400, 'POST /api/payments with boolean amount_paid returns 400');

    const badMethodPayRes = await fetch(`${baseUrl}/api/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ installment_id: testInstId1, amount_paid: 8750, payment_method: 'Crypto' })
    });
    assert(badMethodPayRes.status === 400, 'POST /api/payments with invalid payment_method returns 400');

    // Partial payment rejected
    const partialPayRes = await fetch(`${baseUrl}/api/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ installment_id: testInstId1, amount_paid: 4000.00, payment_method: 'Cash' })
    });
    const partialPayData = await partialPayRes.json();
    assert(
      partialPayRes.status === 400 && partialPayData.message.includes('Partial payments are not permitted'),
      'POST /api/payments rejects partial payment with descriptive 400 error'
    );

    // Overpayment rejected
    const overPayRes = await fetch(`${baseUrl}/api/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ installment_id: testInstId1, amount_paid: 9000.00, payment_method: 'Cash' })
    });
    const overPayData = await overPayRes.json();
    assert(
      overPayRes.status === 400 && overPayData.message.includes('Overpayments are not permitted'),
      'POST /api/payments rejects overpayment with descriptive 400 error'
    );

    // ==========================================
    // 7. SUCCESSFUL PAYMENT RECORDING & RECEIPT GENERATION
    // ==========================================
    console.log('\n--- 7. Successful Payment Recording Tests ---');
    const validPayRes = await fetch(`${baseUrl}/api/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        installment_id: testInstId1,
        amount_paid: 8750.00,
        payment_method: 'UPI',
        reference_number: 'UPI-TXN-998822',
        remarks: 'Q1 fee paid via PhonePe'
      })
    });
    const validPayData = await validPayRes.json();
    assert(
      validPayRes.status === 201 && validPayData.success === true,
      'POST /api/payments succeeds with 201 Created'
    );
    assert(validPayData.data?.payment?.receipt_number.startsWith('REC-'), 'Payment returns valid receipt_number');
    assert(validPayData.data?.installment?.status === 'PAID', 'Response confirms installment status is PAID');
    const recordedPaymentId = validPayData.data?.payment?.id;
    if (recordedPaymentId) {
      createdPaymentIds.push(recordedPaymentId);
    }

    // Verify DB state
    const checkDbInst = await pool.query('SELECT status FROM fee_installments WHERE id = $1', [testInstId1]);
    assert(checkDbInst.rows[0].status === 'PAID', 'Database confirms installment status is updated to PAID');

    const checkDbPayment = await pool.query('SELECT * FROM payments WHERE installment_id = $1', [testInstId1]);
    assert(
      checkDbPayment.rows.length === 1 &&
      checkDbPayment.rows[0].amount_paid === '8750.00' &&
      checkDbPayment.rows[0].payment_method === 'UPI',
      'Database payment row accurately matches request details'
    );

    // Attempt second payment against already-paid installment
    const repeatPayRes = await fetch(`${baseUrl}/api/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        installment_id: testInstId1,
        amount_paid: 8750.00,
        payment_method: 'Cash'
      })
    });
    assert(repeatPayRes.status === 409, 'Payment against already-paid installment returns 409 Conflict');

    // ==========================================
    // 8. CONCURRENCY & RACE CONDITION PROTECTION
    // ==========================================
    console.log('\n--- 8. Concurrency Tests ---');
    // Fire two identical payment requests concurrently for Installment #2
    const [raceRes1, raceRes2] = await Promise.all([
      fetch(`${baseUrl}/api/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          installment_id: testInstId2,
          amount_paid: 8750.00,
          payment_method: 'Card',
          reference_number: 'CARD-RACE-1'
        })
      }),
      fetch(`${baseUrl}/api/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          installment_id: testInstId2,
          amount_paid: 8750.00,
          payment_method: 'Card',
          reference_number: 'CARD-RACE-2'
        })
      })
    ]);

    const statuses = [raceRes1.status, raceRes2.status].sort();
    assert(
      statuses[0] === 201 && statuses[1] === 409,
      `Concurrent payments race condition: exactly one 201 Created and one 409 Conflict (got: ${raceRes1.status}, ${raceRes2.status})`
    );

    const racePaymentDb = await pool.query('SELECT id FROM payments WHERE installment_id = $1', [testInstId2]);
    assert(racePaymentDb.rows.length === 1, 'Exactly one payment record created during concurrent payment race');
    if (racePaymentDb.rows.length > 0) {
      createdPaymentIds.push(racePaymentDb.rows[0].id);
    }

    // ==========================================
    // 9. TRANSACTION ROLLBACK INTEGRITY TEST
    // ==========================================
    console.log('\n--- 9. Transaction Rollback Integrity Test ---');
    // Verify atomic failure rollback: installment 3 status remains PENDING and no payment created
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`
        INSERT INTO payments (installment_id, amount_paid, receipt_number, payment_method)
        VALUES ($1, $2, $3, $4)
      `, [testInstId3, '8750.00', 'REC-SIM-FAIL', 'Cash']);

      // Force simulated error
      throw new Error('Simulated crash between payment insert and installment status update');
    } catch (simErr) {
      await client.query('ROLLBACK');
      assert(simErr.message.includes('Simulated crash'), 'Simulated transaction crash triggered rollback');
    } finally {
      client.release();
    }

    const checkRbPayment = await pool.query('SELECT * FROM payments WHERE installment_id = $1', [testInstId3]);
    assert(checkRbPayment.rows.length === 0, 'No payment record persisted after transaction rollback');

    const checkRbInst = await pool.query('SELECT status FROM fee_installments WHERE id = $1', [testInstId3]);
    assert(checkRbInst.rows[0].status === 'PENDING', 'Installment remains PENDING after rollback');

    // ==========================================
    // 10. PAYMENT RECEIPT DETAILS & STUDENT FEES
    // ==========================================
    console.log('\n--- 10. Payment Receipt & Student Fees Details ---');
    const getPayRes = await fetch(`${baseUrl}/api/payments/${recordedPaymentId}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const getPayData = await getPayRes.json();
    assert(
      getPayRes.status === 200 && getPayData.success === true,
      'GET /api/payments/:id returns 200 OK'
    );
    assert(
      getPayData.data.student &&
      getPayData.data.student.name === 'HistTest Student' &&
      getPayData.data.installment.installment_number === 1 &&
      getPayData.data.amount_paid === '8750.00' &&
      getPayData.data.payment_method === 'UPI',
      'GET /api/payments/:id returns enriched joined student and installment details'
    );

    const notFoundPayRes = await fetch(`${baseUrl}/api/payments/999999`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(notFoundPayRes.status === 404, 'GET /api/payments/999999 returns 404 Not Found');

    const badParamPayRes = await fetch(`${baseUrl}/api/payments/invalid_id`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(badParamPayRes.status === 400, 'GET /api/payments/invalid_id returns 400 Bad Request');

    // Test GET /api/students/:id/fees
    const getStudentFeesRes = await fetch(`${baseUrl}/api/students/${studentId}/fees`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const getStudentFeesData = await getStudentFeesRes.json();
    assert(
      getStudentFeesRes.status === 200 && getStudentFeesData.success === true,
      'GET /api/students/:id/fees returns 200 OK'
    );
    assert(
      getStudentFeesData.data.student.id === studentId &&
      getStudentFeesData.data.student.name === 'HistTest Student',
      'Student fee details contain correct student identification'
    );
    assert(
      Array.isArray(getStudentFeesData.data.installments) &&
      getStudentFeesData.data.installments.length === 4,
      'Student fee details contain all 4 installments'
    );
    assert(
      getStudentFeesData.data.installments[0].status === 'PAID' &&
      getStudentFeesData.data.installments[0].payment !== null &&
      getStudentFeesData.data.installments[0].payment.receipt_number.startsWith('REC-'),
      'Paid installment includes complete payment details and receipt number'
    );
    assert(
      getStudentFeesData.data.installments[2].status === 'PENDING' &&
      getStudentFeesData.data.installments[2].payment === null,
      'Pending installment has payment: null'
    );
    assert(
      getStudentFeesData.data.summary.total_paid === '17500.00' && // 8750 (Inst 1) + 8750 (Inst 2 from concurrency race)
      getStudentFeesData.data.summary.total_pending === '17500.00', // Inst 3 + Inst 4
      'Fee summary accurately computes total_paid (₹17,500.00) and total_pending (₹17,500.00)'
    );

    const notFoundStudentFeesRes = await fetch(`${baseUrl}/api/students/999999/fees`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(notFoundStudentFeesRes.status === 404, 'GET /api/students/999999/fees returns 404 Not Found');

    const badStudentFeesRes = await fetch(`${baseUrl}/api/students/invalid/fees`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(badStudentFeesRes.status === 400, 'GET /api/students/invalid/fees returns 400 Bad Request');

    // ==========================================
    // 11. PAYMENT EDIT & DELETE & FEE STRUCTURE DELETE
    // ==========================================
    console.log('\n--- 11. Payment Edit & Delete & Fee Structure Delete Tests ---');
    
    // Test PUT /api/payments/:id
    const paymentToUpdateId = recordedPaymentId;
    const updatePaymentRes = await fetch(`${baseUrl}/api/payments/${paymentToUpdateId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        payment_method: 'UPI',
        reference_number: 'UPI-REF-UPDATED-999',
        remarks: 'Updated via admin payment edit'
      })
    });
    const updatePaymentData = await updatePaymentRes.json();
    assert(
      updatePaymentRes.status === 200 &&
      updatePaymentData.success === true &&
      updatePaymentData.data.payment_method === 'UPI' &&
      updatePaymentData.data.reference_number === 'UPI-REF-UPDATED-999',
      'PUT /api/payments/:id successfully updates payment method and reference number'
    );

    // Test PUT with invalid payment method
    const badMethodRes = await fetch(`${baseUrl}/api/payments/${paymentToUpdateId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ payment_method: 'Bitcoin' })
    });
    assert(badMethodRes.status === 400, 'PUT /api/payments/:id with invalid method returns 400 Bad Request');

    // Test DELETE /api/payments/:id
    const deletePaymentRes = await fetch(`${baseUrl}/api/payments/${paymentToUpdateId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const deletePaymentData = await deletePaymentRes.json();
    assert(
      deletePaymentRes.status === 200 &&
      deletePaymentData.success === true &&
      deletePaymentData.data.installment.status === 'PENDING',
      'DELETE /api/payments/:id deletes payment and reverts installment status to PENDING'
    );

    // Verify DB confirms payment row is deleted
    const checkDeletedPayment = await pool.query('SELECT id FROM payments WHERE id = $1', [paymentToUpdateId]);
    assert(checkDeletedPayment.rows.length === 0, 'Database confirms payment record was permanently deleted');

    // Verify installment is PENDING in database
    const checkRevertedInst = await pool.query('SELECT status FROM fee_installments WHERE id = $1', [testInstId1]);
    assert(checkRevertedInst.rows[0].status === 'PENDING', 'Database confirms fee_installment status reverted to PENDING');

    // Test DELETE non-existent payment
    const notFoundDeletePaymentRes = await fetch(`${baseUrl}/api/payments/999999`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(notFoundDeletePaymentRes.status === 404, 'DELETE /api/payments/999999 returns 404 Not Found');

    // Test DELETE /api/fee-structures/:id on structure WITH installments -> 409 Conflict
    const deleteBlockedFsRes = await fetch(`${baseUrl}/api/fee-structures/${testFsId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(
      deleteBlockedFsRes.status === 409,
      'DELETE /api/fee-structures/:id with linked installments returns 409 Conflict'
    );

    // Create an isolated empty fee structure without any installments
    const emptyFsRes = await pool.query(
      "INSERT INTO fee_structures (class_id, academic_year, annual_fee) VALUES (3, '2099-2100', 50000.00) RETURNING id"
    );
    const emptyFsId = emptyFsRes.rows[0].id;

    // Test DELETE /api/fee-structures/:id on empty structure -> 200 OK
    const deleteEmptyFsRes = await fetch(`${baseUrl}/api/fee-structures/${emptyFsId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const deleteEmptyFsData = await deleteEmptyFsRes.json();
    assert(
      deleteEmptyFsRes.status === 200 && deleteEmptyFsData.success === true,
      'DELETE /api/fee-structures/:id without linked installments succeeds with 200 OK'
    );

    const checkEmptyFsDeleted = await pool.query('SELECT id FROM fee_structures WHERE id = $1', [emptyFsId]);
    assert(checkEmptyFsDeleted.rows.length === 0, 'Database confirms unused fee structure deleted cleanly');

  } catch (err) {
    console.error('Unexpected error during test execution:', err);
    failed++;
  } finally {
    // Isolated Cleanup: Clean up ONLY test-created resources
    console.log('\n--- Cleaning up isolated test resources ---');
    try {
      if (createdPaymentIds.length > 0) {
        await pool.query('DELETE FROM payments WHERE id = ANY($1)', [createdPaymentIds]);
      }
      if (createdStudentIds.length > 0) {
        await pool.query('DELETE FROM payments WHERE installment_id IN (SELECT id FROM fee_installments WHERE student_id = ANY($1))', [createdStudentIds]);
        await pool.query('DELETE FROM fee_installments WHERE student_id = ANY($1)', [createdStudentIds]);
        await pool.query('DELETE FROM students WHERE id = ANY($1)', [createdStudentIds]);
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
  console.log(`FEE STRUCTURES & PAYMENTS TEST RESULTS:`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
