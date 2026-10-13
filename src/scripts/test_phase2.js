require('dotenv').config();
const http = require('http');
const app = require('../app');
const pool = require('../config/db');

async function runTests() {
  console.log('--- STARTING PHASE 2: CORE SCHOOL APIS TESTS ---');

  const PORT = 5098;
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

    assert(adminToken && teacherToken, 'Obtained tokens for both admin and teacher');

    // 1. Unauthenticated requests should be rejected
    const unauthRes = await fetch(`${baseUrl}/api/classes`);
    assert(unauthRes.status === 401, 'GET /api/classes without token returns 401 Unauthorized');

    // 2. GET /api/classes (with token)
    const classesRes = await fetch(`${baseUrl}/api/classes`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    const classesData = await classesRes.json();
    assert(
      classesRes.status === 200 &&
      classesData.success === true &&
      Array.isArray(classesData.data) &&
      classesData.data.length === 5,
      `GET /api/classes returns 200 and 5 classes (received: ${classesData.data?.length})`
    );

    const firstClassId = classesData.data[0].id;

    // 3. GET /api/classes/:id/sections
    const sectionsRes = await fetch(`${baseUrl}/api/classes/${firstClassId}/sections`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    const sectionsData = await sectionsRes.json();
    assert(
      sectionsRes.status === 200 &&
      sectionsData.success === true &&
      Array.isArray(sectionsData.data) &&
      sectionsData.data.length === 2,
      `GET /api/classes/:id/sections returns 200 and sections for Class 1 (received: ${sectionsData.data?.length})`
    );

    // 4. GET /api/classes/:id/sections with non-existent class
    const notFoundSectionsRes = await fetch(`${baseUrl}/api/classes/9999/sections`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    assert(notFoundSectionsRes.status === 404, 'GET /api/classes/9999/sections returns 404 Not Found');

    // 5. GET /api/classes/invalid/sections with invalid ID
    const badIdSectionsRes = await fetch(`${baseUrl}/api/classes/invalid_id/sections`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    assert(badIdSectionsRes.status === 400, 'GET /api/classes/invalid_id/sections returns 400 Bad Request');

    // 6. GET /api/subjects
    const subjectsRes = await fetch(`${baseUrl}/api/subjects`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    const subjectsData = await subjectsRes.json();
    assert(
      subjectsRes.status === 200 &&
      subjectsData.success === true &&
      Array.isArray(subjectsData.data) &&
      subjectsData.data.length >= 5,
      `GET /api/subjects returns 200 and active subjects list (received: ${subjectsData.data?.length})`
    );

    // 7. GET /api/teachers
    const teachersRes = await fetch(`${baseUrl}/api/teachers`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    const teachersData = await teachersRes.json();
    assert(
      teachersRes.status === 200 &&
      teachersData.success === true &&
      Array.isArray(teachersData.data) &&
      teachersData.data.length >= 3,
      `GET /api/teachers returns 200 and teachers list (received: ${teachersData.data?.length})`
    );

    // 8. GET /api/teacher-assignments
    const assignmentsRes = await fetch(`${baseUrl}/api/teacher-assignments`, {
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    const assignmentsData = await assignmentsRes.json();
    assert(
      assignmentsRes.status === 200 &&
      assignmentsData.success === true &&
      Array.isArray(assignmentsData.data) &&
      assignmentsData.data.length >= 1,
      `GET /api/teacher-assignments returns 200 and joined details (received: ${assignmentsData.data?.length})`
    );

    // 9. Role-based protection: Teacher cannot write
    const teacherWriteSubj = await fetch(`${baseUrl}/api/subjects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({ name: 'History' })
    });
    assert(teacherWriteSubj.status === 403, 'POST /api/subjects with teacher token returns 403 Forbidden');

    const teacherWriteAssign = await fetch(`${baseUrl}/api/teacher-assignments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherToken}`
      },
      body: JSON.stringify({ teacher_id: 1, section_id: 1, subject_id: 1 })
    });
    assert(teacherWriteAssign.status === 403, 'POST /api/teacher-assignments with teacher token returns 403 Forbidden');

    const teacherDeleteAssign = await fetch(`${baseUrl}/api/teacher-assignments/1`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${teacherToken}` }
    });
    assert(teacherDeleteAssign.status === 403, 'DELETE /api/teacher-assignments/:id with teacher token returns 403 Forbidden');

    // 10. Admin POST /api/subjects validation
    const emptySubjRes = await fetch(`${baseUrl}/api/subjects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ name: '' })
    });
    assert(emptySubjRes.status === 400, 'POST /api/subjects with empty name returns 400 Bad Request');

    // 11. Admin POST /api/subjects duplicate check
    const dupSubjRes = await fetch(`${baseUrl}/api/subjects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ name: 'Mathematics' })
    });
    assert(dupSubjRes.status === 409, 'POST /api/subjects with duplicate name returns 409 Conflict');

    // 12. Admin POST /api/subjects valid creation
    const newSubjectName = `TestSubject_${Date.now()}`;
    const createSubjRes = await fetch(`${baseUrl}/api/subjects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ name: newSubjectName })
    });
    const createSubjData = await createSubjRes.json();
    assert(
      createSubjRes.status === 201 &&
      createSubjData.success === true &&
      createSubjData.data.name === newSubjectName,
      'POST /api/subjects creates subject successfully with 201 Created'
    );
    const createdSubjectId = createSubjData.data?.id;

    // 13. Admin POST /api/teacher-assignments validation
    const badAssignRes = await fetch(`${baseUrl}/api/teacher-assignments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ teacher_id: 'abc', section_id: 1 })
    });
    assert(badAssignRes.status === 400, 'POST /api/teacher-assignments with invalid parameters returns 400 Bad Request');

    // 14. Admin POST /api/teacher-assignments non-existent teacher
    const nonExistTeacherRes = await fetch(`${baseUrl}/api/teacher-assignments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ teacher_id: 9999, section_id: 1, subject_id: 1 })
    });
    assert(nonExistTeacherRes.status === 404, 'POST /api/teacher-assignments with non-existent teacher returns 404 Not Found');

    // 15. Admin POST /api/teacher-assignments duplicate assignment
    // From seed data: teacher_id = 1, section_id = 1, subject_id = 1 is already assigned
    const seedAssignRes = await pool.query('SELECT teacher_id, section_id, subject_id FROM teacher_assignments LIMIT 1');
    const existing = seedAssignRes.rows[0];
    const dupAssignRes = await fetch(`${baseUrl}/api/teacher-assignments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify(existing)
    });
    assert(dupAssignRes.status === 409, 'POST /api/teacher-assignments duplicate assignment returns 409 Conflict');

    // 16. Admin POST /api/teacher-assignments successful creation
    // Assign teacher 2 to section 2 with createdSubjectId
    const teacher2Id = teachersData.data.find(t => t.id !== existing.teacher_id)?.id || 2;
    const createAssignRes = await fetch(`${baseUrl}/api/teacher-assignments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        teacher_id: teacher2Id,
        section_id: 2,
        subject_id: createdSubjectId
      })
    });
    const createAssignData = await createAssignRes.json();
    assert(
      createAssignRes.status === 201 &&
      createAssignData.success === true &&
      createAssignData.data.teacher_id === teacher2Id,
      'POST /api/teacher-assignments successfully assigns teacher with 201 Created and enriched details'
    );
    const newAssignmentId = createAssignData.data?.id;

    // 17. Admin DELETE /api/teacher-assignments/:id
    const deleteAssignRes = await fetch(`${baseUrl}/api/teacher-assignments/${newAssignmentId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const deleteAssignData = await deleteAssignRes.json();
    assert(
      deleteAssignRes.status === 200 &&
      deleteAssignData.success === true,
      'DELETE /api/teacher-assignments/:id removes assignment with 200 OK'
    );

    // 18. Admin DELETE /api/teacher-assignments/:id with non-existent id
    const notFoundDeleteRes = await fetch(`${baseUrl}/api/teacher-assignments/999999`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(notFoundDeleteRes.status === 404, 'DELETE /api/teacher-assignments/999999 returns 404 Not Found');

    // 19. Clean up test subject
    if (createdSubjectId) {
      await pool.query('DELETE FROM subjects WHERE id = $1', [createdSubjectId]);
    }

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
