# 🎯 AttendX — Biometric & Geofenced Anti-Proxy Attendance System

> **A high-concurrency, full-stack web application designed to eliminate proxy attendance using a 3-Layer Security Protocol: Browser-Based Biometric Liveness Verification, 15-Second Rotating HMAC-SHA256 QR Tokens, and Haversine Spatial Geofencing.**

[![Live Demo](https://img.shields.io/badge/Live_Demo-Render-brightgreen?style=for-the-badge&logo=render)](https://attendx.onrender.com)
[![GitHub Code](https://img.shields.io/badge/GitHub-Repository-blue?style=for-the-badge&logo=github)](https://github.com/palaparthidinesh99-design/attendX)
[![Node.js](https://img.shields.io/badge/Node.js-v18+-green?style=for-the-badge&logo=nodedotjs)](https://nodejs.org)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas_Cloud-green?style=for-the-badge&logo=mongodb)](https://www.mongodb.com/atlas)
[![Tests](https://img.shields.io/badge/Tests-40%2F40_Passing-brightgreen?style=for-the-badge)](file:///Users/dinesh/Documents/projects/attendence-proxy/server/tests/api.test.js)

---

## 📑 Table of Contents

1. [Executive Summary & Problem Statement](#1-executive-summary--problem-statement)
2. [Full-Stack Architecture Overview](#2-full-stack-architecture-overview)
3. [The 3-Layer Anti-Proxy Security Protocol](#3-the-3-layer-anti-proxy-security-protocol)
   - [Layer 1: Zero-Dependency HTML5 Canvas Facial Biometrics](#layer-1-zero-dependency-html5-canvas-facial-biometrics)
   - [Layer 2: 15-Second Rotating HMAC-SHA256 QR Tokens](#layer-2-15-second-rotating-hmac-sha256-qr-tokens)
   - [Layer 3: Spatial Verification (Haversine + $O(1)$ Bounding Box)](#layer-3-spatial-verification-haversine--o1-bounding-box)
4. [Technology Stack — Simplified for Beginners & Interview Prep](#4-technology-stack--simplified-for-beginners--interview-prep)
   - [What is Node.js?](#what-is-nodejs)
   - [What is Express.js?](#what-is-expressjs)
   - [What is MongoDB & Mongoose?](#what-is-mongodb--mongoose)
   - [What is JWT (JSON Web Token)?](#what-is-jwt-json-web-token)
5. [Database Schema & Data Model Design](#5-database-schema--data-model-design)
6. [API Endpoint Specifications](#6-api-endpoint-specifications)
7. [High-Concurrency Stress Test Benchmark (200 Students in 1.7s)](#7-high-concurrency-stress-test-benchmark-200-students-in-17s)
8. [Local Installation & Setup Guide](#8-local-installation--setup-guide)
9. [Deployment Guide (Render + MongoDB Atlas)](#9-deployment-guide-render--mongodb-atlas)
10. [💡 Master Technical Interview Q&A Guide](#10--master-technical-interview-qa-guide)

---

## 1. Executive Summary & Problem Statement

In academic institutions, traditional attendance methods suffer from severe security flaws:
- **Paper Roll Calls**: Prone to proxy signing by friends.
- **Static QR Codes**: Students snap a photo of the QR code and send it to WhatsApp groups for remote friends to scan from home.
- **GPS-Only Systems**: Easy to bypass using fake GPS location spoofing apps.

**AttendX** solves all three vulnerabilities by enforcing a strict **3-Layer Security Pipeline**:
1. **Biometric Facial Liveness**: Students must perform a live blink/nod motion check and match their registered 128-dimensional facial geometry vector before the QR scanner unlocks.
2. **Rotating QR Cryptography**: The teacher's QR code expires and rotates every **15 seconds** using deterministic HMAC-SHA256 signatures, making photos sent over messaging apps useless.
3. **Spatial Geofencing**: Checks physical proximity using the Haversine trigonometric formula with an $O(1)$ bounding-box optimization and a 25-meter signal tolerance buffer for cellular/Wi-Fi devices.

---

## 2. Full-Stack Architecture Overview

```
 📱 STUDENT MOBILE DEVICE                        🖥️ TEACHER DASHBOARD
 ┌───────────────────────────┐                   ┌───────────────────────────┐
 │ 1. Motion Liveness Check  │                   │ 1. Start Session & Radius │
 │ 2. 128-D Canvas Vector    │                   │ 2. Display Rotating QR    │
 │ 3. Camera Flip Toggle     │                   │ 3. Export CSV Spreadsheet │
 └─────────────┬─────────────┘                   └─────────────┬─────────────┘
               │                                               │
               │ HTTP POST /api/attendance/scan                │ HTTP GET /api/sessions/:id/token
               ▼                                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                             ATTENDX EXPRESS SERVER                          │
│                                                                             │
│  [Helmet Security]  ──►  [Rate Limiter (250/min)]  ──►  [JWT Auth Guard]    │
│                                                                             │
│  1. HMAC Token Verify ($O(1)$ Memory) ──► Rejects Tampered/Expired QR      │
│  2. Haversine Radius Check ($O(1)$ Bounding Box) ──► Rejects Remote Scans  │
│  3. Roster Check ──► Verifies Student Email Enrollment in Course Roster     │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │
                                      ▼
                        ┌───────────────────────────┐
                        │   MONGODB ATLAS CLOUD     │
                        │                           │
                        │ 🔑 Unique Compound Index  │
                        │ { sessionId, studentId }  │
                        │ Rejects Duplicates (409)  │
                        └───────────────────────────┘
```

---

## 3. The 3-Layer Anti-Proxy Security Protocol

### Layer 1: Zero-Dependency HTML5 Canvas Facial Biometrics
- **Location**: `public/js/student.js` (`extractCanvasFaceVector`, `startBiometricScanWorkflow`)
- **How it works**: When a student signs up, they capture their face. Rather than downloading heavy external AI models (which take 5–10MB and lag on mobile networks), AttendX uses an HTML5 Canvas to downsample video frames to a $160 \times 160$ matrix.
- It extracts a **128-dimensional structural illumination and color distribution vector**:
  $$\text{Similarity} = \frac{\mathbf{A} \cdot \mathbf{B}}{\|\mathbf{A}\| \|\mathbf{B}\|} = \frac{\sum_{i=1}^{128} A_i B_i}{\sqrt{\sum A_i^2} \sqrt{\sum B_i^2}}$$
- **Liveness Challenge**: The camera monitors motion variation across consecutive frames ($> 12.0$ motion units) requiring a blink or nod. Once verified ($\ge 70\%$ match), the scanner unlocks.

### Layer 2: 15-Second Rotating HMAC-SHA256 QR Tokens
- **Location**: `server/utils/token.js` (`generateToken`, `verifyToken`)
- **How it works**: The teacher's browser displays a QR code that rotates every **15 seconds**.
- The server generates a deterministic 16-character hex token using HMAC-SHA256:
  $$\text{Window} = \lfloor \frac{\text{Current Time (s)}}{15} \rfloor$$
  $$\text{Token} = \text{HMAC-SHA256}(\text{Session ID} + \text{Time Window}, \text{Session Secret})[:16]$$
- **Clock Skew Tolerance**: When verifying, the server checks both the current time window ($\text{Window}$) and the previous window ($\text{Window} - 1$). This grants a 15-second grace period for network transit delays while strictly rejecting older codes.

### Layer 3: Spatial Verification (Haversine + $O(1)$ Bounding Box)
- **Location**: `server/utils/geofence.js` (`isWithinRadius`, `haversineMeters`)
- **How it works**: Before executing expensive trigonometric calculations, the server runs a fast $O(1)$ **Latitude/Longitude Bounding-Box Pre-Check**:
  $$\Delta \text{Lat} = \frac{\text{Radius (m)}}{111,139}, \quad \Delta \text{Lng} = \frac{\text{Radius (m)}}{111,139 \cdot \cos(\text{Lat})}$$
- If the coordinates fall outside the bounding box, the request is rejected immediately.
- If inside, the server computes the exact spherical distance via the **Haversine Formula**:
  $$a = \sin^2\left(\frac{\Delta \phi}{2}\right) + \cos(\phi_1) \cos(\phi_2) \sin^2\left(\frac{\Delta \lambda}{2}\right)$$
  $$c = 2 \cdot \text{atan2}\left(\sqrt{a}, \sqrt{1-a}\right), \quad d = R \cdot c \quad (R = 6,371,000 \text{ m})$$

---

## 4. Technology Stack — Simplified for Beginners & Interview Prep

If an interviewer asks you to explain the tech stack, use these simple explanations:

### What is Node.js?
> **Interviewer Answer**: *"Node.js is an open-source, cross-platform JavaScript runtime environment that executes JavaScript code outside of a web browser. It uses an event-driven, non-blocking I/O model built on Google's V8 engine, making it lightweight and efficient for handling high-concurrency real-time applications like AttendX."*

### What is Express.js?
> **Interviewer Answer**: *"Express.js is a minimal and flexible web application framework for Node.js. It simplifies building backend REST APIs by providing robust routing (`app.get`, `app.post`), middleware processing (for security, rate limiting, and authentication), and HTTP request/response handling."*

### What is MongoDB & Mongoose?
> **Interviewer Answer**: *"MongoDB is a NoSQL document database that stores data in flexible, JSON-like BSON documents instead of rigid relational tables. Mongoose is an Object Data Modeling (ODM) library for MongoDB and Node.js. It provides schema validation, default values, relationship population (`.populate()`), and unique indexes (`{ sessionId: 1, studentId: 1 }`) to prevent duplicate data."*

### What is JWT (JSON Web Token)?
> **Interviewer Answer**: *"JWT is a compact, URL-safe means of representing claims to be transferred between two parties. When a user logs in, the server signs a token with a secret key containing user data (ID, email, role). The client sends this token in the HTTP `Authorization` header (`Bearer <token>`) for subsequent requests. This eliminates the need for server-side session state, enabling stateless scaling."*

---

## 5. Database Schema & Data Model Design

### 1. User Model (`server/models/User.js`)
```javascript
{
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true }, // Hashed with bcrypt
  role: { type: String, enum: ['teacher', 'student'], required: true },
  faceProfileLocked: { type: Boolean, default: false },
  faceDescriptor: { type: [Number], default: null } // 128-D vector
}
```

### 2. Course Model (`server/models/Course.js`)
```javascript
{
  courseCode: { type: String, required: true, uppercase: true },
  courseName: { type: String, required: true },
  teacherId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  enrolledStudents: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  enrolledEmails: [{ type: String, lowercase: true }]
}
```

### 3. Session Model (`server/models/Session.js`)
```javascript
{
  teacherId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course' },
  className: { type: String, required: true },
  startTime: { type: Date, default: Date.now },
  active: { type: Boolean, default: true },
  secret: { type: String, required: true }, // Random HMAC secret key
  location: {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true }
  },
  radiusMeters: { type: Number, default: 50 }
}
```

### 4. Attendance Model (`server/models/Attendance.js`)
```javascript
{
  sessionId: { type: Schema.Types.ObjectId, ref: 'Session', required: true },
  studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  timestamp: { type: Date, default: Date.now },
  distanceMeters: { type: Number, required: true }
}
// Unique compound index prevents duplicate check-ins at database level:
Attendance.index({ sessionId: 1, studentId: 1 }, { unique: true });
```

---

## 6. API Endpoint Specifications

| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/register` | Public | Register new Teacher or Student account |
| `POST` | `/api/auth/login` | Public | Authenticate user & return JWT token |
| `POST` | `/api/auth/face-profile` | Student | Register & lock 1-time facial profile vector |
| `POST` | `/api/courses` | Teacher | Create new course |
| `POST` | `/api/courses/:id/enroll` | Teacher | Enroll student emails into course roster |
| `GET`  | `/api/courses/:id/export-csv` | Teacher | Export complete attendance CSV (Present & Absent) |
| `POST` | `/api/sessions` | Teacher | Start new attendance session with location & radius |
| `POST` | `/api/sessions/:id/end` | Teacher | End active session (converts unscanned to Missed ❌) |
| `GET`  | `/api/sessions/:id/token` | Teacher | Fetch rotating 15s HMAC QR token |
| `POST` | `/api/attendance/scan` | Student | Submit biometric face + GPS + QR check-in |
| `GET`  | `/api/attendance/analytics` | Student | Fetch subject percentages & date-grouped calendar |
| `GET`  | `/health` | Public | Cloud health status (`UP`, DB state, uptime) |

---

## 7. High-Concurrency Stress Test Benchmark (200 Students in 1.7s)

To prove enterprise reliability, we executed a live concurrency benchmark firing **200 student check-in HTTP POST requests simultaneously at the exact same millisecond** (`scripts/concurrency-test.js`):

```text
🚀 Initiating 200 Concurrent Student Check-In Stress Test...

👥 Registering 200 unique student accounts...
⚡ Firing 200 SIMULTANEOUS check-in requests at the exact same millisecond...

=====================================================
⏱️ TOTAL TIME FOR ALL 200 CONCURRENT SCANS: 1,788 ms (1.78 seconds)
📊 SUCCESSFUL CHECK-INS (HTTP 200)        : 200 / 200 (100%)
🛡️ DUPLICATE REJECTIONS (HTTP 409)        : 0
❌ OTHER ERRORS                            : 0
📁 MONGO DATABASE RECORDS CREATED         : 200 / 200
=====================================================

🎉 VERDICT: 100% SUCCESS! System handled 200 concurrent student scans flawlessly!
```

### Why it handles 200+ students effortlessly:
1. **Client Offloading**: Facial geometry calculations run on the student's browser. Server video processing load is **0%**.
2. **In-Memory Cryptography**: HMAC token and Haversine distance checks execute in memory ($< 0.1\text{ms}$) before hitting the database.
3. **Database Unique Indexing**: MongoDB compound index `{ sessionId: 1, studentId: 1 }` rejects duplicate scans in $O(1)$ time.

---

## 8. Local Installation & Setup Guide

### Prerequisites
- [Node.js v18+](https://nodejs.org)
- [MongoDB Community Server](https://www.mongodb.com/try/download/community) (or MongoDB Atlas Cloud string)

### Steps
1. **Clone the Repository**:
   ```bash
   git clone https://github.com/palaparthidinesh99-design/attendX.git
   cd attendX
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables (`.env`)**:
   Create a `.env` file in the project root:
   ```env
   MONGODB_URI=mongodb://127.0.0.1:27017/attendance_system
   JWT_SECRET=your_super_secret_jwt_key_12345
   PORT=3000
   ```

4. **Run Unit & Integration Test Suite (40/40 Passing)**:
   ```bash
   npm test
   ```

5. **Start Development Server**:
   ```bash
   npm run dev
   ```
   Open **`http://localhost:3000`** in your browser!

---

## 9. Deployment Guide (Render + MongoDB Atlas)

1. **MongoDB Atlas Setup**:
   - Go to [MongoDB Atlas](https://cloud.mongodb.com) $\rightarrow$ **Network Access** $\rightarrow$ Add IP Address `0.0.0.0/0` (Allow Access From Anywhere).

2. **Deploy on Render**:
   - Log in to [Render Dashboard](https://dashboard.render.com) $\rightarrow$ **New +** $\rightarrow$ **Web Service**.
   - Connect repository: `palaparthidinesh99-design/attendX`.
   - **Build Command**: `npm install`
   - **Start Command**: `node server/server.js`
   - **Health Check Path**: `/health`
   - Add Environment Variables:
     - `MONGODB_URI`: Your MongoDB Atlas SRV URI
     - `JWT_SECRET`: Your secure secret string
     - `NODE_ENV`: `production`

---

## 10. 💡 Master Technical Interview Q&A Guide

When presenting **AttendX** to interviewers, use these 10 structured Q&As:

### Q1: "What inspired you to build AttendX?"
> **Answer**: *"Traditional attendance systems suffer from proxy attendance—students take photos of static QR codes or use fake GPS apps. I built AttendX as a full-stack solution featuring a 3-Layer Security Pipeline: browser-based biometric liveness, 15-second rotating HMAC QR tokens, and spatial geofence validation to make proxy attendance mathematically impossible."*

### Q2: "How did you implement face recognition without heavy server load?"
> **Answer**: *"Instead of streaming heavy camera video to the server, I offloaded computation to the client's browser using the HTML5 Canvas API. The browser downsamples video frames into a 160x160 matrix to compute a 128-dimensional structural vector. It verifies facial similarity ($\ge 70\%$) and motion liveness (blink/nod) locally before unlocking the QR scanner. This keeps server CPU load at 0%."*

### Q3: "How do you prevent students from photographing the QR code and sharing it on WhatsApp?"
> **Answer**: *"The QR code is not static. The backend generates a 16-character hex token signed with HMAC-SHA256 that rotates every 15 seconds based on the current unix time window. If a student sends a photo to a friend, the code expires by the time the remote friend tries to scan it."*

### Q4: "How does the geofence calculation work?"
> **Answer**: *"I implemented the Haversine formula to compute great-circle distances between the student's GPS coordinates and the classroom location. To optimize performance, I added an $O(1)$ latitude/longitude bounding-box pre-check that discards out-of-bounds requests before running trigonometric calculations."*

### Q5: "What happens if 200 students submit attendance at the exact same second?"
> **Answer**: *"I benchmarked this exact scenario! The system processed 200 simultaneous check-in requests in 1.78 seconds (115+ check-ins/sec). Node.js handles async requests smoothly, token and geofence checks execute in memory in $<0.1\text{ms}$, and MongoDB's unique compound index `{ sessionId: 1, studentId: 1 }` guarantees zero double-counting."*

### Q6: "Why did you choose MongoDB over a relational SQL database like PostgreSQL?"
> **Answer**: *"Attendance records and session documents are highly document-centric. MongoDB allows storing embedded geo-coordinates (`location: { lat, lng }`), student email arrays, and dynamic analytics cleanly. Combined with Mongoose schema validation and unique indexing, MongoDB provided speed and flexibility."*

### Q7: "How do you handle JWT security and roles?"
> **Answer**: *"Upon login, the server signs a JWT containing the user's ID, email, and role (`teacher` or `student`). Routes are protected with custom Express middleware (`authenticate` and `requireRole`). Students cannot invoke teacher endpoints like session creation or CSV export."*

### Q8: "How does your database handle server connection failures?"
> **Answer**: *"I built an automatic database failover system in `server/server.js`. Connection attempts to MongoDB Atlas have a 5-second fast timeout (`serverSelectionTimeoutMS: 5000`). If Atlas is unreachable due to network drops, the application seamlessly falls back to a local MongoDB instance."*

### Q9: "How is attendance percentage calculated for students?"
> **Answer**: *"Attendance percentage is calculated strictly against **ended sessions** ($\frac{\text{Attended Sessions}}{\text{Ended Sessions}} \times 100\%$). While a class is ongoing (`active === true`), unscanned enrolled students see 'In Progress' so live classes do not artificially drop their attendance percentage."*

### Q10: "How did you test the application for bugs?"
> **Answer**: *"I wrote a comprehensive 40-test suite (`npm test`) covering unit tests for HMAC token expiration and Haversine distance bounds, alongside full integration API tests using Supertest to validate registration, session creation, roster enrollment, and CSV exports."*

---

### 👨‍💻 Author & Repository
- **GitHub**: [palaparthidinesh99-design/attendX](https://github.com/palaparthidinesh99-design/attendX)
- **Live Demo**: [https://attendx.onrender.com](https://attendx.onrender.com)
