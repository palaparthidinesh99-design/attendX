# 🔍 AttendX — In-Depth System Flows & Component Architecture Codebook

> **Complete Technical Guide to Every Component, Utility, Algorithm, and Route Execution Flow**  
> *Includes exact file paths, code implementations, input/output data contracts, and architectural flow diagrams.*

---

## 📑 Table of Contents

1. [Authentication Guard & JWT Pipeline](#1-authentication-guard--jwt-pipeline)
2. [WebAuthn Passkey Hardware Authentication Flow](#2-webauthn-passkey-hardware-authentication-flow)
3. [15-Second Rotating HMAC SHA-256 Token Engine](#3-15-second-rotating-hmac-sha-256-token-engine)
4. [Spatial Geofencing & $O(1)$ Bounding-Box Pre-Filter](#4-spatial-geofencing--o1-bounding-box-pre-filter)
5. [Student Attendance Check-In Submission Pipeline](#5-student-attendance-check-in-submission-pipeline)
6. [Teacher Session Management & Live Attendance Feed](#6-teacher-session-management--live-attendance-feed)
7. [Student Analytics Engine & Interactive Calendar Component](#7-student-analytics-engine--interactive-calendar-component)
8. [IST-Aware CSV Roster Export Engine](#8-ist-aware-csv-roster-export-engine)
9. [Database Schema Validation & Compound Unique Indexing](#9-database-schema-validation--compound-unique-indexing)
10. [Database Connection Manager & Health Probe Failover](#10-database-connection-manager--health-probe-failover)

---

## 1. Authentication Guard & JWT Pipeline

### 📁 File Location
- Middleware: [`server/middleware/auth.js`](file:///Users/dinesh/Documents/projects/attendence-proxy/server/middleware/auth.js)
- Token Sign & Verification Utility: [`server/routes/auth.js`](file:///Users/dinesh/Documents/projects/attendence-proxy/server/routes/auth.js)

### 🔄 Logical Execution Flow
```
[ HTTP Request with Header ] ---> Authorization: Bearer <jwt_token>
                                           |
                                           v
[ authenticate Middleware ] -----> Extract Bearer token from header
                                           |
                                           v
                             jwt.verify(token, JWT_SECRET)
                                    /             \
                             (Valid)               (Invalid / Expired)
                               /                         \
                              v                           v
                   Attach req.user                   Return HTTP 401
                              |
                              v
                   [ requireRole Guard ]
                            /         \
                      (Role Match)   (Role Mismatch)
                           /             \
                          v               v
                   Execute Route     Return HTTP 403
```

### 💻 Code Implementation (`server/middleware/auth.js`)
```javascript
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_fallback_secret_key_12345';

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access token missing or malformed' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { id, name, email, role }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalid or expired' });
  }
};

const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient privileges' });
    }
    next();
  };
};

module.exports = { authenticate, requireRole };
```

---

## 2. WebAuthn Passkey Hardware Authentication Flow

### 📁 File Locations
- Server Routes: [`server/routes/auth.js`](file:///Users/dinesh/Documents/projects/attendence-proxy/server/routes/auth.js)
- Client Controller: [`public/js/student.js`](file:///Users/dinesh/Documents/projects/attendence-proxy/public/js/student.js)
- User Model: [`server/models/User.js`](file:///Users/dinesh/Documents/projects/attendence-proxy/server/models/User.js)

### 🔄 Registration Sequence Flow
```
[ Student UI ] -----------------------------------------------> [ Server Endpoint ]
  Click "Register Touch ID"
  POST /api/auth/webauthn/register-options
                                                                  generateRegistrationOptions()
                                                                  Save currentChallenge in DB
  <------------------------------------------------------------   Return Challenge Options JSON

  @simplewebauthn/browser startRegistration(options)
  Device OS prompts Touch ID / Fingerprint
  Hardware Secure Enclave signs challenge

  POST /api/auth/webauthn/register-verify
  Payload: { attestationResponse }
                                                                  verifyRegistrationResponse()
                                                                  Check challenge match & origin
                                                                  Save publicKey & credentialID in DB
  <------------------------------------------------------------   Return { verified: true }
```

### 💻 Server Registration Code (`server/routes/auth.js`)
```javascript
router.post('/webauthn/register-options', authenticate, requireRole('student'), async (req, res) => {
  const user = await User.findById(req.user.id);
  const opts = await generateRegistrationOptions({
    rpName: 'AttendX Biometric Portal',
    rpID: req.hostname === 'localhost' ? 'localhost' : req.hostname,
    userID: new TextEncoder().encode(user._id.toString()),
    userName: user.email,
    userDisplayName: user.name,
    attestationType: 'none',
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: 'preferred',
      residentKey: 'discouraged'
    }
  });

  user.currentChallenge = opts.challenge;
  await user.save();
  res.json(opts);
});

router.post('/webauthn/register-verify', authenticate, requireRole('student'), async (req, res) => {
  const user = await User.findById(req.user.id);
  const verification = await verifyRegistrationResponse({
    response: req.body,
    expectedChallenge: user.currentChallenge,
    expectedOrigin: `${req.protocol}://${req.get('host')}`,
    expectedRPID: req.hostname === 'localhost' ? 'localhost' : req.hostname
  });

  if (verification.verified && verification.registrationInfo) {
    const { credentialID, credentialPublicKey, counter } = verification.registrationInfo;
    user.webauthnDevices.push({
      credentialID: Buffer.from(credentialID).toString('base64url'),
      publicKey: Buffer.from(credentialPublicKey).toString('base64url'),
      counter
    });
    user.currentChallenge = null;
    await user.save();
    return res.json({ verified: true });
  }
  res.status(400).json({ error: 'Registration verification failed' });
});
```

### 💻 Client Hardware Trigger Code (`public/js/student.js`)
```javascript
async function setupPasskey() {
  const optsRes = await fetch('/api/auth/webauthn/register-options', {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` }
  });
  const opts = await optsRes.json();

  // Invokes native browser WebAuthn prompt
  const attResp = await SimpleWebAuthnBrowser.startRegistration(opts);

  const verifyRes = await fetch('/api/auth/webauthn/register-verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`
    },
    body: JSON.stringify(attResp)
  });
  const verifyData = await verifyRes.json();
  if (verifyData.verified) {
    alert('✓ Touch ID / Fingerprint Passkey registered successfully!');
    checkPasskeyStatus();
  }
}
```

---

## 3. 15-Second Rotating HMAC SHA-256 Token Engine

### 📁 File Locations
- Core Utility: [`server/utils/token.js`](file:///Users/dinesh/Documents/projects/attendence-proxy/server/utils/token.js)
- Session Routes: [`server/routes/sessions.js`](file:///Users/dinesh/Documents/projects/attendence-proxy/server/routes/sessions.js)
- Teacher UI Sync Loop: [`public/js/teacher.js`](file:///Users/dinesh/Documents/projects/attendence-proxy/public/js/teacher.js)

### 🔄 Mathematical Rotation Formula
$$\text{timeWindow} = \lfloor \frac{\text{Date.now()}}{15000} \rfloor$$
$$\text{Token} = \text{HMAC-SHA256}\Big(\text{sessionId} + \text{":"} + \text{timeWindow}, \, \text{sessionSecret}\Big).substring(0, 16)$$

### 💻 Token Generator & Drift Verification Utility (`server/utils/token.js`)
```javascript
const crypto = require('crypto');

function generateToken(sessionId, secret, timeWindow = null) {
  if (!sessionId || !secret) return null;
  if (timeWindow === null) {
    timeWindow = Math.floor(Date.now() / 15000);
  }
  const message = `${sessionId}:${timeWindow}`;
  return crypto.createHmac('sha256', secret).update(message).digest('hex').substring(0, 16);
}

function verifyToken(token, sessionId, secret) {
  if (!token || !sessionId || !secret) return false;
  const currentWindow = Math.floor(Date.now() / 15000);

  // Check current window [W]
  const currentToken = generateToken(sessionId, secret, currentWindow);
  if (token === currentToken) return true;

  // Check previous window [W-1] for clock skew & transit tolerance
  const prevToken = generateToken(sessionId, secret, currentWindow - 1);
  return token === prevToken;
}

module.exports = { generateToken, verifyToken };
```

### 💻 Teacher 100ms UI Sync Loop (`public/js/teacher.js`)
```javascript
function startContinuousQRLoop() {
  async function updateLoop() {
    if (!activeSession) return;

    const now = Date.now();
    const currentWindow = Math.floor(now / 15000);
    const msIntoWindow = now % 15000;
    const remainingMs = 15000 - msIntoWindow;

    // Update progress bar UI smoothly
    const progressBar = document.getElementById('qr-progress-bar');
    if (progressBar) progressBar.style.width = `${((remainingMs / 15000) * 100).toFixed(1)}%`;

    // Fetch new token when window transitions
    if (currentWindow !== lastWindowIndex) {
      lastWindowIndex = currentWindow;
      await fetchAndDisplayQRToken();
    }

    qrLoopTimer = setTimeout(updateLoop, 100);
  }
  updateLoop();
}
```

---

## 4. Spatial Geofencing & $O(1)$ Bounding-Box Pre-Filter

### 📁 File Location
- Geofence Utility: [`server/utils/geofence.js`](file:///Users/dinesh/Documents/projects/attendence-proxy/server/utils/geofence.js)

### 🔄 Dual-Phase Algorithm
```
[ Incoming GPS Coordinates ] (studentLat, studentLng)
             |
             v
 [ Phase 1: O(1) Bounding Box Pre-Check ]
   maxLatDiff = radiusMeters / 111139
   if |studentLat - teacherLat| > maxLatDiff
             /                                   \
      (Exceeds Box)                          (Inside Box)
           /                                       \
          v                                         v
   Return { isWithinRadius: false }      [ Phase 2: Spherical Haversine Math ]
                                           Calculate exact distance in meters
                                                    |
                                                    v
                                         Return { isWithinRadius: d <= radius, distanceMeters }
```

### 💻 Code Implementation (`server/utils/geofence.js`)
```javascript
const EARTH_RADIUS_METERS = 6371000; // 6,371 km
const LAT_DEGREE_METERS = 111139;    // 1° latitude ≈ 111.14 km

function haversineDistance(lat1, lon1, lat2, lon2) {
  const toRad = deg => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

function isWithinRadius(studentLat, studentLng, teacherLat, teacherLng, radiusMeters = 50) {
  // 1. Fast O(1) Bounding-Box Pre-Check
  const maxLatDiff = radiusMeters / LAT_DEGREE_METERS;
  if (Math.abs(studentLat - teacherLat) > maxLatDiff) {
    return { isWithinRadius: false, distanceMeters: null };
  }

  // 2. Exact Spherical Haversine Calculation
  const dist = haversineDistance(studentLat, studentLng, teacherLat, teacherLng);
  return {
    isWithinRadius: dist <= radiusMeters,
    distanceMeters: Math.round(dist * 10) / 10
  };
}

module.exports = { haversineDistance, isWithinRadius };
```

---

## 5. Student Attendance Check-In Submission Pipeline

### 📁 File Locations
- Attendance Routes: [`server/routes/attendance.js`](file:///Users/dinesh/Documents/projects/attendence-proxy/server/routes/attendance.js)
- Attendance Schema: [`server/models/Attendance.js`](file:///Users/dinesh/Documents/projects/attendence-proxy/server/models/Attendance.js)

### 🔄 End-to-End Pipeline
```
1. Student scans QR code & gets geolocation (lat, lng).
2. Sends POST /api/attendance/scan with payload { sessionId, token, lat, lng }.
3. Server executes validation chain:
   ├── JWT Auth Middleware -> Validates student token
   ├── Session Lookup -> Verifies session is active
   ├── Token Verification -> Checks 15s HMAC signature (verifyToken)
   ├── Geofence Verification -> Checks Haversine radius (isWithinRadius)
   └── MongoDB Write -> Saves document & enforces unique index { sessionId, studentId }
4. On success: Returns HTTP 200 OK with attendance record.
5. On duplicate: MongoDB throws E11000 -> Route catches & returns HTTP 409 Conflict.
```

### 💻 Code Implementation (`server/routes/attendance.js`)
```javascript
router.post('/scan', authenticate, requireRole('student'), async (req, res, next) => {
  try {
    const { sessionId, token, lat, lng } = req.body;
    const studentId = req.user.id;

    if (!sessionId || !token || lat == null || lng == null) {
      return res.status(400).json({ error: 'sessionId, token, lat, and lng are required' });
    }

    const session = await Session.findById(sessionId).populate('courseId');
    if (!session || !session.active) {
      return res.status(400).json({ error: 'Attendance session is closed or inactive' });
    }

    // Verify HMAC Token
    const isValid = verifyToken(token, session._id.toString(), session.secret);
    if (!isValid) {
      return res.status(401).json({ error: 'Expired or invalid QR code. Please scan again.' });
    }

    // Verify Geofence
    const geofence = isWithinRadius(lat, lng, session.location.lat, session.location.lng, session.radiusMeters);
    if (!geofence.isWithinRadius) {
      return res.status(403).json({
        error: `Out of classroom range (${geofence.distanceMeters}m away). Must be within ${session.radiusMeters}m.`,
        distanceMeters: geofence.distanceMeters
      });
    }

    // Persist Attendance Record
    const attendance = await Attendance.create({
      sessionId: session._id,
      studentId,
      courseId: session.courseId._id,
      dateString: getISTDateString(),
      timeString: getISTTimeString(),
      distanceMeters: geofence.distanceMeters,
      isWithinRadius: true
    });

    res.status(200).json({ message: 'Attendance marked successfully', attendance });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Attendance already marked for this session' });
    }
    next(err);
  }
});
```

---

## 6. Teacher Session Management & Live Attendance Feed

### 📁 File Location
- Session Routes: [`server/routes/sessions.js`](file:///Users/dinesh/Documents/projects/attendence-proxy/server/routes/sessions.js)

### 💻 Code Implementation
```javascript
// Start New Session
router.post('/', authenticate, requireRole('teacher'), async (req, res, next) => {
  try {
    const { courseId, className, lat, lng, radiusMeters } = req.body;
    const secret = crypto.randomBytes(32).toString('hex'); // 256-bit random secret

    // Deactivate old active sessions for this course
    await Session.updateMany({ courseId, active: true }, { active: false });

    const session = await Session.create({
      teacherId: req.user.id,
      courseId,
      className,
      secret,
      location: { lat, lng },
      radiusMeters: radiusMeters || 50,
      active: true,
      dateString: getISTDateString(),
      startTimeString: getISTTimeString()
    });

    res.status(201).json(session);
  } catch (err) { next(err); }
});

// Live Attendance Counter Polling
router.get('/:id/live', authenticate, async (req, res, next) => {
  try {
    const count = await Attendance.countDocuments({ sessionId: req.params.id });
    const records = await Attendance.find({ sessionId: req.params.id })
      .populate('studentId', 'name rollNumber email')
      .sort({ scannedAt: -1 });

    res.json({ count, records });
  } catch (err) { next(err); }
});
```

---

## 7. Student Analytics Engine & Interactive Calendar Component

### 📁 File Locations
- Analytics Route: [`server/routes/attendance.js`](file:///Users/dinesh/Documents/projects/attendence-proxy/server/routes/attendance.js)
- Client Renderer: [`public/js/student.js`](file:///Users/dinesh/Documents/projects/attendence-proxy/public/js/student.js)

### 💻 Aggregation & Percentage Calculation Code
```javascript
router.get('/student-analytics', authenticate, requireRole('student'), async (req, res, next) => {
  try {
    const studentId = req.user.id;
    const student = await User.findById(studentId);

    // Find courses student is enrolled in
    const courses = await Course.find({ enrolledEmails: student.email });

    const subjectStats = await Promise.all(courses.map(async (c) => {
      const endedSessions = await Session.find({ courseId: c._id, active: false });
      const totalEndedSessions = endedSessions.length;

      const attendedSessions = await Attendance.countDocuments({
        courseId: c._id,
        studentId
      });

      const percentage = totalEndedSessions > 0
        ? Math.round((attendedSessions / totalEndedSessions) * 100)
        : 100;

      return {
        courseId: c._id,
        courseCode: c.courseCode,
        courseName: c.courseName,
        totalEndedSessions,
        attendedSessions,
        percentage
      };
    }));

    res.json({ subjectStats });
  } catch (err) { next(err); }
});
```

---

## 8. IST-Aware CSV Roster Export Engine

### 📁 File Location
- Course Routes: [`server/routes/courses.js`](file:///Users/dinesh/Documents/projects/attendence-proxy/server/routes/courses.js)

### 💻 Code Implementation
```javascript
router.get('/:id/export-csv', authenticate, requireRole('teacher'), async (req, res, next) => {
  try {
    const course = await Course.findById(req.params.id);
    const sessions = await Session.find({ courseId: course._id }).sort({ createdAt: 1 });
    const attendances = await Attendance.find({ courseId: course._id }).populate('studentId');

    let csv = 'Student Roll Number,Student Name,Student Email,Session Name,Date (IST),Time (IST),Status,Distance (m)\n';

    for (let email of course.enrolledEmails) {
      const student = await User.findOne({ email, role: 'student' });
      const studentName = student ? student.name : 'Unregistered Student';
      const rollNo = student ? (student.rollNumber || 'N/A') : 'N/A';

      for (let s of sessions) {
        const att = attendances.find(a =>
          a.sessionId.toString() === s._id.toString() &&
          a.studentId && a.studentId.email === email
        );

        const status = att ? 'PRESENT' : 'ABSENT';
        const dateStr = att ? att.dateString : s.dateString;
        const timeStr = att ? att.timeString : 'N/A';
        const dist = att ? att.distanceMeters : 'N/A';

        csv += `"${rollNo}","${studentName}","${email}","${s.className}","${dateStr}","${timeStr}","${status}","${dist}"\n`;
      }
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${course.courseCode}_Attendance_Report.csv"`);
    res.status(200).send(csv);
  } catch (err) { next(err); }
});
```

---

## 9. Database Schema Validation & Compound Unique Indexing

### 📁 File Location
- Attendance Model: [`server/models/Attendance.js`](file:///Users/dinesh/Documents/projects/attendence-proxy/server/models/Attendance.js)

### 💻 Code Implementation
```javascript
const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  courseId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  scannedAt: { type: Date, default: Date.now },
  dateString: { type: String, required: true }, // Format: "YYYY-MM-DD" IST
  timeString: { type: String, required: true }, // Format: "HH:MM:SS AM/PM IST"
  distanceMeters: { type: Number },
  isWithinRadius: { type: Boolean, default: true }
}, { timestamps: true });

// Enforces 100% database-level uniqueness to reject duplicate scans
attendanceSchema.index({ sessionId: 1, studentId: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', attendanceSchema);
```

---

## 10. Database Connection Manager & Health Probe Failover

### 📁 File Location
- Application Entry Point: [`server/server.js`](file:///Users/dinesh/Documents/projects/attendence-proxy/server/server.js)

### 💻 Code Implementation
```javascript
const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const cors = require('cors');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health Check Probe Endpoint for Render / Kubernetes
app.get('/health', (req, res) => {
  const dbState = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  res.status(200).json({ status: 'UP', database: dbState, timestamp: new Date().toISOString() });
});

// Database Connection with Connection Pooling
const MONGODB_URI = process.env.MONGODB_URI;
mongoose.connect(MONGODB_URI, {
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000
}).then(() => {
  console.log('✅ Connected to MongoDB Atlas Cloud');
}).catch(err => {
  console.error('❌ MongoDB Connection Error:', err.message);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 AttendX Server listening on port ${PORT}`));
```

---

> **End of AttendX Architecture & Component Flow Codebook**
