/* server/tests/api.test.js — End-to-end API Integration Test Suite */

process.env.NODE_ENV = 'test';
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/attendance_system_test';

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
  console.log('\n🚀 Running API Integration Test Suite...\n');

  try {
    try {
      await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 3000 });
    } catch (_) {
      await mongoose.connect('mongodb://127.0.0.1:27017/attendance_system_test', { serverSelectionTimeoutMS: 3000 });
    }
    // Clear test database collections before test run
    await mongoose.connection.dropDatabase();

    // ── 1. Health Check ──────────────────────────────────────────────────
    const healthRes = await request(app).get('/health');
    assert('/health returns status UP and 200 OK', healthRes.status === 200 && healthRes.body.status === 'UP');
    assert('/health returns connected database state', healthRes.body.database === 'connected');

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
    const student2Token = student2Res.body.token;

    // Login test
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'ada@university.edu',
        password: 'securepassword123'
      });
    assert('Student login returns 200 OK with valid user role', loginRes.status === 200 && loginRes.body.user.role === 'student');

    // Invalid login test
    const badLoginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'ada@university.edu',
        password: 'wrongpassword'
      });
    assert('Invalid password returns 401 Unauthorized', badLoginRes.status === 401);

    // ── 3. Session Creation ───────────────────────────────────────────────
    // Center coords: 12.9716, 77.5946 (Bengaluru)
    const sessionRes = await request(app)
      .post('/api/sessions')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        className: 'Algorithms 101',
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
        className: 'Illegal Session',
        lat: 12.9716,
        lng: 77.5946
      });
    assert('Student attempting session creation returns 403 Forbidden', forbiddenSessionRes.status === 403);

    // ── 4. Rotating Token Retrieval ──────────────────────────────────────
    const tokenRes = await request(app).get(`/api/sessions/${sessionId}/token`);
    assert('Fetching token returns 200 OK with 16-char token & window expiration',
      tokenRes.status === 200 && typeof tokenRes.body.token === 'string' && tokenRes.body.token.length === 16);
    const qrToken = tokenRes.body.token;

    // ── 5. Attendance Scanning ───────────────────────────────────────────
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
    assert('Duplicate scan returns 409 Conflict', duplicateScanRes.status === 409 && duplicateScanRes.body.error.includes('already marked'));

    // Out-of-Radius Scan (Student 2 is ~490m away, beyond the 200m buffer)
    const outOfRadiusScanRes = await request(app)
      .post('/api/attendance/scan')
      .set('Authorization', `Bearer ${student2Token}`)
      .send({
        sessionId,
        token: qrToken,
        lat: 12.9760, // ~490 meters away
        lng: 77.5946
      });
    assert('Out-of-radius scan returns 403 Forbidden with distance meters',
      outOfRadiusScanRes.status === 403 && outOfRadiusScanRes.body.distanceMeters > 200);

    // Tampered / Expired Token Scan
    const badTokenScanRes = await request(app)
      .post('/api/attendance/scan')
      .set('Authorization', `Bearer ${student2Token}`)
      .send({
        sessionId,
        token: 'invalid_token_123',
        lat: 12.9716,
        lng: 77.5946
      });
    assert('Invalid/expired HMAC token returns 401 Unauthorized', badTokenScanRes.status === 401);

    // Invalid Coordinate Range Scan
    const badCoordScanRes = await request(app)
      .post('/api/attendance/scan')
      .set('Authorization', `Bearer ${student2Token}`)
      .send({
        sessionId,
        token: qrToken,
        lat: 999.0, // Invalid latitude
        lng: 77.5946
      });
    assert('Out-of-bound latitude returns 400 Bad Request', badCoordScanRes.status === 400);

    // Far distance Geofence Check
    const poorGpsScanRes = await request(app)
      .post('/api/attendance/scan')
      .set('Authorization', `Bearer ${student2Token}`)
      .send({
        sessionId,
        token: qrToken,
        lat: 12.9810, // ~1km away
        lng: 77.5946,
        accuracyMeters: 50
      });
    assert('Out-of-bounds scan returns 403 Forbidden', poorGpsScanRes.status === 403);

    // ── 6. Live Attendance Retrieval ─────────────────────────────────────
    const attendanceRes = await request(app)
      .get(`/api/sessions/${sessionId}/attendance`)
      .set('Authorization', `Bearer ${teacherToken}`);
    assert('Teacher live attendance returns 200 OK with count 1',
      attendanceRes.status === 200 && attendanceRes.body.count === 1 && attendanceRes.body.records[0].student.email === 'ada@university.edu');

    // Student history check
    const myHistoryRes = await request(app)
      .get('/api/attendance/my')
      .set('Authorization', `Bearer ${studentToken}`);
    assert('Student history returns 200 OK with 1 record', myHistoryRes.status === 200 && myHistoryRes.body.length === 1);

    console.log(`\n🎉 Integration Test Suite Completed: ${passed} passed, ${failed} failed\n`);

  } catch (err) {
    console.error('❌ Test suite fatal error:', err);
    failed++;
  } finally {
    await mongoose.connection.close();
    if (failed > 0) process.exit(1);
    else process.exit(0);
  }
}

runApiTests();
