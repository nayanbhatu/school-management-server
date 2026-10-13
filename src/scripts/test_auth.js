require('dotenv').config();
const http = require('http');
const app = require('../app');
const pool = require('../config/db');

async function runTests() {
  console.log('--- STARTING AUTHENTICATION & AUTHORIZATION TESTS ---');

  // Start HTTP server on port 5099 for testing
  const PORT = 5099;
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(PORT, resolve));
  const baseUrl = `http://localhost:${PORT}`;

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message}`);
      failed++;
    }
  }

  try {
    // 1. Health check
    const healthRes = await fetch(`${baseUrl}/api/health`);
    const healthData = await healthRes.json();
    assert(healthRes.status === 200 && healthData.success === true, 'GET /api/health returns 200 and success: true');

    // 2. Health DB check
    const healthDbRes = await fetch(`${baseUrl}/api/health/db`);
    const healthDbData = await healthDbRes.json();
    assert(healthDbRes.status === 200 && healthDbData.success === true, 'GET /api/health/db returns 200 and success: true');

    // 3. Login with missing body
    const missingRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const missingData = await missingRes.json();
    assert(missingRes.status === 400 && missingData.success === false, 'POST /api/auth/login with empty body returns 400');

    // 4. Login with invalid password
    const wrongPassRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrongpassword' })
    });
    const wrongPassData = await wrongPassRes.json();
    assert(wrongPassRes.status === 401 && wrongPassData.success === false && wrongPassData.message === 'Invalid credentials', 'POST /api/auth/login with wrong password returns 401 and generic message');

    // 5. Login with non-existent user
    const nonUserRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'nonexistent_user', password: 'password123' })
    });
    const nonUserData = await nonUserRes.json();
    assert(nonUserRes.status === 401 && nonUserData.success === false && nonUserData.message === 'Invalid credentials', 'POST /api/auth/login with non-existent user returns 401 and generic message');

    // 6. Login with valid Admin credentials
    const adminRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'password123' })
    });
    const adminData = await adminRes.json();
    assert(
      adminRes.status === 200 &&
      adminData.success === true &&
      typeof adminData.token === 'string' &&
      adminData.user.role === 'admin' &&
      adminData.user.password_hash === undefined,
      'POST /api/auth/login with valid admin credentials returns 200, JWT token, safe user data (no password_hash)'
    );
    const adminToken = adminData.token;

    // 7. Login with valid Teacher credentials (using username)
    const teacherRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'teacher1', password: 'password123' })
    });
    const teacherData = await teacherRes.json();
    assert(
      teacherRes.status === 200 &&
      teacherData.success === true &&
      teacherData.user.role === 'teacher' &&
      teacherData.user.email === 'teacher1@school.com' &&
      teacherData.user.password_hash === undefined,
      'POST /api/auth/login with valid teacher1 credentials returns 200, JWT token, and teacher profile'
    );
    const teacherToken = teacherData.token;

    // 8. Login with Teacher Email as identifier
    const teacherEmailRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'teacher1@school.com', password: 'password123' })
    });
    const teacherEmailData = await teacherEmailRes.json();
    assert(
      teacherEmailRes.status === 200 &&
      teacherEmailData.success === true &&
      teacherEmailData.user.username === 'teacher1',
      'POST /api/auth/login supports teacher email identifier'
    );

    // 9. GET /api/auth/me without token
    const noTokenRes = await fetch(`${baseUrl}/api/auth/me`);
    const noTokenData = await noTokenRes.json();
    assert(noTokenRes.status === 401 && noTokenData.success === false, 'GET /api/auth/me without token returns 401');

    // 10. GET /api/auth/me with invalid token
    const badTokenRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: 'Bearer this_is_an_invalid_token' }
    });
    const badTokenData = await badTokenRes.json();
    assert(badTokenRes.status === 401 && badTokenData.success === false, 'GET /api/auth/me with invalid token returns 401');

    // 11. GET /api/auth/me with valid Admin token
    const meAdminRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const meAdminData = await meAdminRes.json();
    assert(
      meAdminRes.status === 200 &&
      meAdminData.success === true &&
      meAdminData.user.username === 'admin' &&
      meAdminData.user.role === 'admin' &&
      meAdminData.user.password_hash === undefined,
      'GET /api/auth/me with Admin token returns 200 and authenticated admin profile'
    );

    // 12. GET /api/auth/me with valid Teacher token
    const meTeacherRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    const meTeacherData = await meTeacherRes.json();
    assert(
      meTeacherRes.status === 200 &&
      meTeacherData.success === true &&
      meTeacherData.user.username === 'teacher1' &&
      meTeacherData.user.role === 'teacher' &&
      meTeacherData.user.email === 'teacher1@school.com' &&
      meTeacherData.user.password_hash === undefined,
      'GET /api/auth/me with Teacher token returns 200 and authenticated teacher profile'
    );

    // 13. Inactive user rejection test (deactivate teacher3 temporarily, test rejection, then restore)
    await pool.query("UPDATE teachers SET is_active = FALSE WHERE email = 'teacher3@school.com'");
    const inactiveLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'teacher3', password: 'password123' })
    });
    const inactiveLoginData = await inactiveLoginRes.json();
    assert(
      inactiveLoginRes.status === 403 &&
      inactiveLoginData.success === false &&
      inactiveLoginData.message.includes('inactive'),
      'POST /api/auth/login rejects inactive users with 403'
    );

    // Restore teacher3 is_active = TRUE
    await pool.query("UPDATE teachers SET is_active = TRUE WHERE email = 'teacher3@school.com'");
    const restoredLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'teacher3', password: 'password123' })
    });
    assert(restoredLoginRes.status === 200, 'POST /api/auth/login succeeds after teacher reactivated');

    // 14. authorizeRoles middleware unit tests
    const { authorizeRoles } = require('../middleware/auth.middleware');
    const adminMiddleware = authorizeRoles('admin');
    
    let adminAllowed = false;
    adminMiddleware({ user: { role: 'admin' } }, {}, () => { adminAllowed = true; });
    assert(adminAllowed === true, 'authorizeRoles("admin") allows user with role "admin"');

    let teacherBlocked = false;
    let blockStatusCode = 0;
    const mockRes = {
      status(code) { blockStatusCode = code; return this; },
      json(payload) { teacherBlocked = payload.success === false; }
    };
    adminMiddleware({ user: { role: 'teacher' } }, mockRes, () => {});
    assert(teacherBlocked === true && blockStatusCode === 403, 'authorizeRoles("admin") blocks user with role "teacher" with 403 Forbidden');

    const multiRoleMiddleware = authorizeRoles('admin', 'teacher');
    let teacherAllowedMulti = false;
    multiRoleMiddleware({ user: { role: 'teacher' } }, {}, () => { teacherAllowedMulti = true; });
    assert(teacherAllowedMulti === true, 'authorizeRoles("admin", "teacher") allows user with role "teacher"');

  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    server.close();
    await pool.end();
    console.log(`\n--- TESTS COMPLETE: ${passed} passed, ${failed} failed ---`);
    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests();
