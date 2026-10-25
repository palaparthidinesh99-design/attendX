/* backend/tests/api.test.js — PostgreSQL API Integration Test Suite */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_secret_for_integration_testing_12345';
const request = require('supertest');
const app = require('../src/app');
const { initDB, getPool } = require('../src/config/db');

let passed = 0;
let failed = 0;

function assert(description, condition) {
  if (condition) {
    console.log(`  ✅ ${description}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${description}`);
    failed++;
  }
}

async function runApiTests() {
  console.log('\n🚀 Running PostgreSQL API Integration Test Suite...\n');

  try {
    // 0. Initialize DB Schema
    await initDB();

    // ── 1. Health Check ──────────────────────────────────────────────────
    const healthRes = await request(app).get('/health');
    assert('/health returns status UP and 200 OK', healthRes.status === 200 && healthRes.body.status === 'UP');
    assert('/health returns connected PostgreSQL engine', healthRes.body.engine === 'PostgreSQL' && healthRes.body.database === 'connected');

    // ── 2. User Authentication ───────────────────────────────────────────
    const teacherRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Prof. Alan Turing',
        email: 'turing@university.edu',
        password: 'securepassword123',
        role: 'teacher'
      });
    assert('Teacher registration returns 201 Created with JWT', teacherRes.status === 201 && !!teacherRes.body.token);
    const teacherToken = teacherRes.body.token;

    const studentRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Ada Lovelace',
        email: 'ada@university.edu',
        password: 'securepassword123',
        role: 'student',
        rollNumber: 'CS1801'
      });
    assert('Student registration returns 201 Created with JWT', studentRes.status === 201 && !!studentRes.body.token);
    const studentToken = studentRes.body.token;

    const student2Res = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Grace Hopper',
        email: 'grace@university.edu',
        password: 'securepassword123',
        role: 'student',
        rollNumber: 'CS1802'
      });
    assert('Student 2 registration returns 201 Created', student2Res.status === 201);
    const student2Token = student2Res.body.token;

    // Duplicate email check
    const dupRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Duplicate Ada',
        email: 'ada@university.edu',
        password: 'securepassword123',
        role: 'student'
      });
    assert('Duplicate email registration returns 409 Conflict', dupRes.status === 409);

    // Login test
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'ada@university.edu',
        password: 'securepassword123'
      });
    assert('Student login returns 200 OK with valid user role', loginRes.status === 200 && loginRes.body.user.role === 'student');

    // Bad password
    const badLoginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'ada@university.edu',
        password: 'wrongpassword'
      });
    assert('Invalid password returns 401 Unauthorized', badLoginRes.status === 401);

    // ── 3. Course Creation & Enrollment ──────────────────────────────────
    const courseRes = await request(app)
      .post('/api/courses')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        courseCode: 'CS101',
        courseName: 'Algorithms & Data Structures'
      });
    assert('Teacher creates course CS101 (201 Created)', courseRes.status === 201 && !!courseRes.body.id);
    const courseId = courseRes.body.id;

    // Enroll Ada Lovelace into CS101
    const enrollRes = await request(app)
      .post(`/api/courses/${courseId}/enroll`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        emails: ['ada@university.edu']
      });
    assert('Teacher enrolls student email into course (200 OK)', enrollRes.status === 200);

    // ── 4. Session Creation ───────────────────────────────────────────────
    // Center coordinates: 12.9716, 77.5946 (Bengaluru)
    const sessionRes = await request(app)
      .post('/api/sessions')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        className: 'CS101 — Lecture 1',
        courseId,
        lat: 12.9716,
        lng: 77.5946,
        radiusMeters: 50
      });
    assert('Teacher creates session successfully (201 Created)', sessionRes.status === 201 && !!sessionRes.body.sessionId);
    const sessionId = sessionRes.body.sessionId;

    // Student trying to create session (role guard check)
    const forbiddenSessionRes = await request(app)
      .post('/api/sessions')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        className: 'Illegal Student Session',
        courseId,
        lat: 12.9716,
        lng: 77.5946
      });
    assert('Student attempting session creation returns 403 Forbidden', forbiddenSessionRes.status === 403);

    // ── 5. Rotating Token Retrieval ──────────────────────────────────────
    const tokenRes = await request(app).get(`/api/sessions/${sessionId}/token`);
    assert('Fetching session QR token returns 200 OK with 16-char token',
      tokenRes.status === 200 && typeof tokenRes.body.token === 'string' && tokenRes.body.token.length === 16);
    const qrToken = tokenRes.body.token;

    // ── 6. Attendance Scanning ───────────────────────────────────────────
    // Valid Scan (0m distance)
    const validScanRes = await request(app)
      .post('/api/attendance/scan')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        sessionId,
        token: qrToken,
        lat: 12.9716,
        lng: 77.5946,
        accuracyMeters: 10
      });
    assert('Valid scan inside radius returns 200 OK with record',
      validScanRes.status === 200 && validScanRes.body.success === true && validScanRes.body.record.distanceMeters === 0);

    // Duplicate Scan (Same session + same student)
    const duplicateScanRes = await request(app)
      .post('/api/attendance/scan')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        sessionId,
        token: qrToken,
        lat: 12.9716,
        lng: 77.5946
      });
    assert('Duplicate scan returns 409 Conflict', duplicateScanRes.status === 409);

    // Student 2 is NOT enrolled -> should receive 403 Access Denied
    const unenrolledScanRes = await request(app)
      .post('/api/attendance/scan')
      .set('Authorization', `Bearer ${student2Token}`)
      .send({
        sessionId,
        token: qrToken,
        lat: 12.9716,
        lng: 77.5946
      });
    assert('Unenrolled student scan returns 403 Access Denied', unenrolledScanRes.status === 403);

    // Enroll student 2 now
    await request(app)
      .post(`/api/courses/${courseId}/enroll`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ emails: ['grace@university.edu'] });

    // Out-of-radius scan: Student 2 is ~490m away
    const outOfRadiusScanRes = await request(app)
      .post('/api/attendance/scan')
      .set('Authorization', `Bearer ${student2Token}`)
      .send({
        sessionId,
        token: qrToken,
        lat: 12.9760,
        lng: 77.5946
      });
    assert('Out-of-radius scan returns 403 Forbidden with distance meters',
      outOfRadiusScanRes.status === 403 && outOfRadiusScanRes.body.distanceMeters > 50);

    // ── 7. Teacher Live Attendance & End Session ──────────────────────────
    const attendanceRes = await request(app)
      .get(`/api/sessions/${sessionId}/attendance`)
      .set('Authorization', `Bearer ${teacherToken}`);
    assert('Teacher live attendance returns 200 OK with count 1',
      attendanceRes.status === 200 && attendanceRes.body.count === 1);

    // End session
    const endRes = await request(app)
      .post(`/api/sessions/${sessionId}/end`)
      .set('Authorization', `Bearer ${teacherToken}`);
    assert('Teacher ends session (200 OK)', endRes.status === 200);

    // ── 8. Student Analytics ─────────────────────────────────────────────
    const analyticsRes = await request(app)
      .get('/api/attendance/analytics')
      .set('Authorization', `Bearer ${studentToken}`);
    assert('Student analytics returns 200 OK with subjects and calendar breakdown',
      analyticsRes.status === 200 && Array.isArray(analyticsRes.body.subjects) && analyticsRes.body.subjects.length > 0);

    console.log(`\n🎉 PostgreSQL Integration Test Suite Completed: ${passed} passed, ${failed} failed\n`);
  } catch (err) {
    console.error('❌ Test suite fatal error:', err);
    failed++;
  } finally {
    try {
      const pool = getPool();
      if (pool) await pool.end();
    } catch (_) {}
    if (failed > 0) process.exit(1);
    else process.exit(0);
  }
}

runApiTests();
