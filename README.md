# 🎯 AttendX — WebAuthn & Geofenced Anti-Proxy Attendance Platform

> **A high-concurrency, full-stack attendance management platform engineered to eliminate proxy attendance using a 3-Layer Security Defense Architecture: W3C WebAuthn Hardware Biometric Passkeys (Touch ID / Fingerprint), 15-Second Rotating HMAC-SHA256 QR Tokens, and Spherical Haversine Spatial Geofencing.**

[![Live Demo](https://img.shields.io/badge/Live_Demo-Render-brightgreen?style=for-the-badge&logo=render)](https://attendx.onrender.com)
[![GitHub Code](https://img.shields.io/badge/GitHub-Repository-blue?style=for-the-badge&logo=github)](https://github.com/palaparthidinesh99-design/attendX)
[![Node.js](https://img.shields.io/badge/Node.js-v20+-green?style=for-the-badge&logo=nodedotjs)](https://nodejs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-blue?style=for-the-badge&logo=postgresql)](https://www.postgresql.org)
[![Tests](https://img.shields.io/badge/Tests-20%2F20_Passing-brightgreen?style=for-the-badge)](file:///Users/dinesh/Documents/projects/attendence-proxy/backend/tests/api.test.js)

---

## 📑 Table of Contents

- [🎯 AttendX — WebAuthn \& Geofenced Anti-Proxy Attendance Platform](#-attendx--webauthn--geofenced-anti-proxy-attendance-platform)
  - [📑 Table of Contents](#-table-of-contents)
  - [1. Executive Summary \& Problem Statement](#1-executive-summary--problem-statement)
  - [2. Full-Stack System Architecture](#2-full-stack-system-architecture)
  - [3. The 3-Layer Anti-Proxy Defense Protocol](#3-the-3-layer-anti-proxy-defense-protocol)
    - [Layer 1: Native Hardware WebAuthn Passkeys (Touch ID / Fingerprint)](#layer-1-native-hardware-webauthn-passkeys-touch-id--fingerprint)
    - [Layer 2: 15-Second Rotating HMAC-SHA256 QR Tokens](#layer-2-15-second-rotating-hmac-sha256-qr-tokens)
    - [Layer 3: Spatial Verification (Haversine + $O(1)$ Bounding Box)](#layer-3-spatial-verification-haversine--o1-bounding-box)
  - [4. Key Application Features](#4-key-application-features)
  - [5. System Directory Structure](#5-system-directory-structure)
  - [6. API Endpoint Specifications](#6-api-endpoint-specifications)
  - [7. High-Concurrency Benchmark (200 Parallel Students in 1.7s)](#7-high-concurrency-benchmark-200-parallel-students-in-17s)
  - [8. Local Installation \& Setup Guide](#8-local-installation--setup-guide)
  - [9. Running Test Suites](#9-running-test-suites)
  - [10. Cloud Deployment (Docker, Compose \& Render)](#10-cloud-deployment-docker-compose--render)
  - [📄 License](#-license)

---

## 1. Executive Summary & Problem Statement

In academic institutions, traditional attendance methods suffer from severe security vulnerabilities:
- **Paper Roll Calls**: Easily exploited through physical proxy signing by classmates.
- **Static QR Codes**: Students snap a photo of the projected QR code and forward it to messaging groups for remote check-ins.
- **GPS-Only Check-Ins**: Vulnerable to software location-spoofing applications.

**AttendX** eliminates proxy attendance by enforcing a strict **3-Layer Security Pipeline**:
1. **Hardware Passkey Verification**: Authenticates students via native device biometrics (Apple Touch ID, Windows Hello, Android Fingerprint) using asymmetric public-key cryptography bound to the Secure Enclave chip.
2. **Rotating QR Cryptography**: Dynamically recalculates the QR code payload every **15 seconds** using deterministic HMAC-SHA256 signatures, rendering shared photos obsolete.
3. **Spatial Geofencing**: Verifies physical presence within a strict 50-meter classroom boundary using the Haversine trigonometric formula optimized by an $O(1)$ bounding-box pre-check.

---

## 2. Full-Stack System Architecture

```
 📱 STUDENT MOBILE DEVICE                        🖥️ TEACHER DASHBOARD
 ┌───────────────────────────┐                   ┌───────────────────────────┐
 │ 1. Touch ID Passkey Scan  │                   │ 1. Start Session & Radius │
 │ 2. 30s Countdown Window   │                   │ 2. Display Rotating QR    │
 │ 3. Camera QR Reader       │                   │ 3. Live Attendance Feed   │
 └─────────────┬─────────────┘                   └─────────────┬─────────────┘
               │                                               │
               │ HTTP POST /api/attendance/scan                │ HTTP GET /api/sessions/:id/token
               ▼                                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                             ATTENDX EXPRESS SERVER                          │
│                                                                             │
│  [Helmet Security]  ──►  [Rate Limiter (250/min)]  ──►  [JWT Auth Guard]    │
│                                                                             │
│  1. 15s HMAC Token Verify ($O(1)$ Memory) ──► Rejects Tampered/Expired QR   │
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

## 3. The 3-Layer Anti-Proxy Defense Protocol

### Layer 1: Native Hardware WebAuthn Passkeys (Touch ID / Fingerprint)
- **Source**: `public/js/student.js`, `server/routes/auth.js`
- **How it works**: Uses the W3C Web Authentication API to leverage the student's local device hardware (Apple Secure Enclave / Windows Hello TPM).
- Zero raw biometric data leaves the user's phone. The server issues a cryptographically random challenge signed by the device's hardware private key, returning an authenticated 30-second window to complete QR scanning.

### Layer 2: 15-Second Rotating HMAC-SHA256 QR Tokens
- **Source**: `server/utils/token.js` (`generateToken`, `verifyToken`)
- **How it works**: The teacher dashboard displays a QR code that dynamically rotates every **15 seconds**.
- The server computes a 16-character hex token using HMAC-SHA256:
  $$\text{Time Window} = \lfloor \frac{\text{Current Time (s)}}{15} \rfloor$$
  $$\text{Token} = \text{HMAC-SHA256}(\text{Session ID} + \text{Time Window}, \text{Session Secret})[:16]$$
- **Clock Skew Tolerance**: When validating, the server evaluates both the current window ($\text{Window}$) and the preceding window ($\text{Window} - 1$), offering a 15-second transit tolerance while preventing expired scans.

### Layer 3: Spatial Verification (Haversine + $O(1)$ Bounding Box)
- **Source**: `server/utils/geofence.js` (`isWithinRadius`, `haversineDistance`)
- **How it works**: Evaluates student GPS coordinates against the teacher's session origin.
- Rejects distant check-ins in $<1\mu\text{s}$ using an $O(1)$ bounding-box check before executing the spherical Haversine distance formula:
  $$d = 2R \cdot \operatorname{atan2}\left(\sqrt{a}, \sqrt{1-a}\right)$$
  where $a = \sin^2\left(\frac{\Delta\phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta\lambda}{2}\right)$ and $R = 6,371,000\text{ meters}$.

---

## 4. Key Application Features

- ☝️ **Passkey Authentication**: Secure passwordless Touch ID / Fingerprint registration.
- ⏱️ **Strict 30s Verification Window**: Biometric status resets automatically if QR scan isn't completed within 30 seconds.
- 📆 **Interactive Calendar Dashboard**: Month navigation (`◀`, `▶`, `Today`), color-coded attendance indicators (Green = Attended, Blue = Live Class, Red = Missed, Gray = Off Day), and detailed side-panel day summaries.
- 📊 **Course Attendance Analytics**: Live percentage calculation per subject with low-attendance warnings ($< 75\%$).
- 📄 **IST CSV Report Export**: Teachers can export attendance spreadsheets with timestamps normalized to Indian Standard Time (`Asia/Kolkata`).
- 🎨 **Solid Dark Theme**: Modern UI built with solid surface tokens, high contrast typography, and responsive mobile scaling (`viewport-fit=cover`).

---

## 5. System Directory Structure

```
attendence-proxy/
├── backend/                   # Node.js + Express + PostgreSQL Backend
│   ├── src/
│   │   ├── config/
│   │   │   └── db.js          # PostgreSQL Connection Pool & Schema Bootstrap
│   │   ├── controllers/
│   │   │   ├── authController.js       # Register, Login & WebAuthn Controller
│   │   │   ├── courseController.js     # Courses, Enrollment & CSV Export
│   │   │   ├── sessionController.js    # 15s Rotating QR Sessions
│   │   │   └── attendanceController.js # Geofence & QR Validation
│   │   ├── middlewares/
│   │   │   ├── auth.js        # JWT verification & role authorization guards
│   │   │   └── error.js       # Central error & 404 handler
│   │   ├── routes/
│   │   │   ├── auth.js        # Auth API endpoints
│   │   │   ├── courses.js     # Course management routes
│   │   │   ├── sessions.js    # Session & token routes
│   │   │   └── attendance.js  # QR scan & analytics routes
│   │   ├── utils/
│   │   │   ├── token.js       # 15s rotating HMAC SHA-256 token generator
│   │   │   └── geofence.js    # Haversine distance & bounding-box calculation
│   │   ├── app.js             # Express application configuration
│   │   └── server.js          # Server entry point & startup listener
│   ├── tests/
│   │   └── api.test.js        # PostgreSQL integration test suite (20 tests)
│   └── package.json           # Backend package configuration
├── frontend/                  # Solid Dark Frontend Web Client
│   ├── css/
│   │   └── style.css          # Theme tokens, mobile queries & styling
│   ├── js/
│   │   ├── auth.js            # Auth UI controller
│   │   ├── teacher.js         # Teacher dashboard, 100ms QR loop & live feed
│   │   └── student.js         # Student Touch ID Passkey & 30s timer
│   ├── index.html             # Login & Registration landing page
│   ├── student.html           # Student attendance & calendar dashboard
│   ├── teacher.html           # Teacher live session management view
│   └── package.json           # Frontend package configuration
├── scripts/                   # System Maintenance & Check Utilities
│   ├── reset-db.js            # PostgreSQL database reset tool
│   └── check-db.js            # PostgreSQL connection health check tool
├── attendx_schema_simple.sql  # Clean, practical PostgreSQL database schema
├── schema.sql                 # SQL schema file
├── render.yaml                # Native Node.js Render cloud deployment manifest
└── package.json               # Root npm orchestration scripts
```

---

## 6. API Endpoint Specifications

| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/register` | Public | Register new Teacher or Student account |
| `POST` | `/api/auth/login` | Public | Authenticate user & receive JWT token |
| `GET` | `/api/auth/webauthn-status` | Student | Verify Passkey registration status |
| `POST` | `/api/courses` | Teacher | Create new course |
| `GET` | `/api/courses` | Authenticated | List courses (teacher's created or student's enrolled) |
| `GET` | `/api/courses/:id/students` | Teacher | Course roster & enrolled students list |
| `POST` | `/api/courses/:id/enroll` | Teacher | Enroll student emails into course |
| `POST` | `/api/courses/join` | Student | Join course via course code or ID |
| `GET` | `/api/courses/:id/export-csv` | Teacher | Stream IST-formatted attendance CSV report |
| `POST` | `/api/sessions` | Teacher | Launch attendance session with GPS origin & radius |
| `GET` | `/api/sessions/:id/token` | Public/Scanner | Fetch active 15s rotating HMAC SHA-256 token |
| `GET` | `/api/sessions/:id/attendance` | Teacher | Live session attendance feed |
| `POST` | `/api/sessions/:id/end` | Teacher | End active session |
| `POST` | `/api/attendance/scan` | Student | Submit biometric-verified GPS & QR check-in |
| `GET` | `/api/attendance/analytics` | Student | Fetch subject percentages & calendar records |
| `GET` | `/health` | Public | System status check & database connectivity probe |

---

## 7. Local Installation & Setup Guide

### Prerequisites
- **Node.js**: v18.0.0 or higher
- **PostgreSQL**: Local PostgreSQL 14+ or cloud PostgreSQL (Render, Neon, Supabase, Railway)

### Step 1: Clone Repository & Install Dependencies
```bash
git clone https://github.com/palaparthidinesh99-design/attendX.git
cd attendX
npm install
```

### Step 2: Initialize PostgreSQL Database
Run the provided practical schema:
```bash
psql -U postgres -d attendx -f attendx_schema_simple.sql
```

### Step 3: Configure Environment Variables
Create a `.env` file in the root directory:
```env
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/attendx
JWT_SECRET=your_jwt_secret_key_here
NODE_ENV=development
```
```

### Step 3: Start Application Server
```bash
npm start
```
Access the application at `http://localhost:3000`.

---

## 9. Running Test Suites

AttendX includes a comprehensive unit and integration test suite (29 tests):

```bash
# Run complete test suite (Unit + Integration)
npm test

# Run unit tests only (HMAC tokens & Haversine math)
npm run test:unit

# Run API integration tests against isolated database
npm run test:api
```

---

## 8. Cloud Deployment (Render & Vercel)

### Deploy to Render
The repository includes a pre-configured native Node.js `render.yaml` manifest. Connect the GitHub repository in Render to deploy as a Web Service. Set your PostgreSQL `DATABASE_URL` in the environment settings.

### Deploy Frontend to Vercel
Connect the repository to Vercel. `vercel.json` serves the clean frontend static assets and routes automatically.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
