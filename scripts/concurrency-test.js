process.env.NODE_ENV = 'test';
const http = require('http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = require('../server/server');
const User = require('../server/models/User');
const Course = require('../server/models/Course');
const Session = require('../server/models/Session');
const Attendance = require('../server/models/Attendance');
const { generateToken } = require('../server/utils/token');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_fallback_secret_key_12345';
const PORT = 3009;
const TARGET_CONCURRENCY = 200;

async function runConcurrencyStressTest() {
  console.log(`🚀 Initiating ${TARGET_CONCURRENCY} Concurrent Student Check-In Stress Test...\n`);

  try {
    try {
      await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
    } catch (_) {
      await mongoose.connect('mongodb://127.0.0.1:27017/attendance_system_test', { serverSelectionTimeoutMS: 3000 });
    }
  } catch (err) {
    console.error('Database connection error:', err.message);
  }

  // Start test server on port 3009
  const server = app.listen(PORT, async () => {
    try {
      // 1. Setup Test Teacher & Session
      const teacher = await User.create({
        name: 'Prof. Stress Test 200',
        email: `stress200_teacher_${Date.now()}@test.edu`,
        password: 'password123',
        role: 'teacher'
      });

      const course = await Course.create({
        courseCode: `STRESS200_${Date.now()}`,
        courseName: '200 Concurrency Architecture',
        teacherId: teacher._id,
        enrolledEmails: []
      });

      const session = await Session.create({
        teacherId: teacher._id,
        courseId: course._id,
        className: '200 Student Concurrent Surge Test',
        secret: 'stress200_secret_key_99',
        location: { lat: 12.9716, lng: 77.5946 },
        radiusMeters: 100,
        active: true
      });

      const qrToken = generateToken(session._id.toString(), session.secret);

      // 2. Register & Create Tokens for 200 Unique Students
      console.log(`👥 Registering ${TARGET_CONCURRENCY} unique student accounts...`);
      const studentDocs = [];
      const studentEmails = [];

      for (let i = 1; i <= TARGET_CONCURRENCY; i++) {
        studentEmails.push(`student_stress200_${i}_${Date.now()}@test.edu`);
      }

      course.enrolledEmails = studentEmails;
      await course.save();

      for (let i = 0; i < TARGET_CONCURRENCY; i++) {
        studentDocs.push({
          name: `Student #${i + 1}`,
          email: studentEmails[i],
          password: 'password123',
          role: 'student'
        });
      }

      const createdStudents = await User.insertMany(studentDocs);
      const studentJwts = createdStudents.map(s => jwt.sign({ userId: s._id, role: s.role, name: s.name, email: s.email }, JWT_SECRET, { expiresIn: '1h' }));

      console.log(`⚡ Firing ${TARGET_CONCURRENCY} SIMULTANEOUS check-in requests at the exact same millisecond...\n`);

      const startTime = Date.now();

      // Send 200 HTTP POST requests concurrently using Promise.all
      const requests = studentJwts.map((stToken) => {
        return new Promise((resolve) => {
          const postData = JSON.stringify({
            sessionId: session._id.toString(),
            token: qrToken,
            lat: 12.9716, // Exactly inside classroom
            lng: 77.5946,
            accuracyMeters: 15
          });

          const options = {
            hostname: 'localhost',
            port: PORT,
            path: '/api/attendance/scan',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${stToken}`,
              'Content-Length': Buffer.byteLength(postData)
            }
          };

          const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
              resolve({ statusCode: res.statusCode, body });
            });
          });

          req.on('error', err => resolve({ statusCode: 500, error: err.message }));
          req.write(postData);
          req.end();
        });
      });

      const results = await Promise.all(requests);
      const totalTime = Date.now() - startTime;

      // 3. Analyze Results
      const success200 = results.filter(r => r.statusCode === 200).length;
      const fail409 = results.filter(r => r.statusCode === 409).length;
      const errors = results.filter(r => r.statusCode !== 200 && r.statusCode !== 409).length;

      const totalDbRecords = await Attendance.countDocuments({ sessionId: session._id });

      console.log('=====================================================');
      console.log(`⏱️ TOTAL TIME FOR ${TARGET_CONCURRENCY} CONCURRENT SCANS: ${totalTime} ms`);
      console.log(`📊 SUCCESSFUL CHECK-INS (HTTP 200): ${success200} / ${TARGET_CONCURRENCY}`);
      console.log(`🛡️ DUPLICATE REJECTIONS (HTTP 409): ${fail409}`);
      console.log(`❌ OTHER ERRORS: ${errors}`);
      console.log(`📁 TOTAL MONGO DATABASE RECORDS CREATED: ${totalDbRecords} / ${TARGET_CONCURRENCY}`);
      console.log('=====================================================\n');

      if (success200 === TARGET_CONCURRENCY && totalDbRecords === TARGET_CONCURRENCY) {
        console.log(`🎉 VERDICT: 100% SUCCESS! System handled ${TARGET_CONCURRENCY} concurrent student scans flawlessly!`);
      } else {
        console.log('⚠️ VERDICT: Concurrency stress test finished with warnings.');
      }

      // Cleanup test documents
      await User.deleteMany({ _id: { $in: [teacher._id, ...createdStudents.map(s => s._id)] } });
      await Course.deleteOne({ _id: course._id });
      await Session.deleteOne({ _id: session._id });
      await Attendance.deleteMany({ sessionId: session._id });

      server.close();
      process.exit(0);
    } catch (err) {
      console.error('Stress test error:', err);
      server.close();
      process.exit(1);
    }
  });
}

runConcurrencyStressTest();
