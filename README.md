# AttendX — Secure Attendance System

A secure, anti-proxy attendance system with **rotating HMAC QR codes** and **GPS geofencing**. Built with Node/Express/MongoDB and vanilla JS.

## Features

| Feature | Implementation |
|---|---|
| **Rotating QR** | HMAC-SHA256 token rotates every 15 seconds |
| **Anti-screenshot** | Tokens expire in ≤30s, screenshots useless after one rotation |
| **GPS Geofence** | Bounding-box pre-check + Haversine — must be inside classroom radius |
| **Replay prevention** | Compound unique DB index `(sessionId, studentId)` — no token tracking needed |
| **Duplicate scan** | DB rejects with 11000 duplicate key → 409 response |
| **Zero I/O token check** | HMAC self-verifying, no DB read for token validity |

## Stack

- **Backend**: Node.js + Express (single `server.js` + 3 route files)
- **Database**: MongoDB + Mongoose (2 collections, 4 API endpoints)
- **Frontend**: Vanilla JS, 2 HTML pages, no framework or build step
- **Auth**: JWT (7-day expiry)

## Setup

### Prerequisites
- Node.js ≥ 18
- MongoDB running locally (or Atlas URI)

### Install

```bash
npm install
```

### Configure

Edit `.env`:
```
MONGODB_URI=mongodb://localhost:27017/attendance_system
JWT_SECRET=your_super_secret_key_change_this
PORT=3000
```

### Run

```bash
# Development (auto-restart)
npm run dev

# Production
npm start
```

Open http://localhost:3000

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | — | Register teacher or student |
| POST | `/api/auth/login` | — | Login, returns JWT |
| POST | `/api/sessions` | Teacher | Create a new attendance session |
| GET  | `/api/sessions/:id/token` | — | Get current rotating QR token |
| GET  | `/api/sessions/:id/attendance` | Teacher | Live attendance list |
| POST | `/api/sessions/:id/end` | Teacher | End a session |
| POST | `/api/attendance/scan` | Student | Submit attendance (token + lat/lng) |
| GET  | `/api/attendance/my` | Student | Student's own history |

## Security Architecture

### HMAC Token
```
token = HMAC-SHA256(sessionId + ":" + timeWindow, perSessionSecret).hex[:16]
```
- `timeWindow = floor(Date.now() / 15000)` — changes every 15 seconds
- Accepts current and previous window (~30s tolerance for network latency)
- Self-verifying: server recomputes and compares — **zero DB reads**

### Scan Endpoint Check Order (cheapest → most expensive)
1. **Session active?** — DB read already needed for secret
2. **Token valid?** — HMAC recompute, no I/O
3. **Inside geofence?** — bounding-box pre-check, then Haversine if needed
4. **DB write** — unique index rejects duplicates (error code 11000 → 409)

### Geofence
```
withinBoundingBox() → O(1) rejection for obviously-out-of-range coords
haversineMeters()   → exact great-circle distance, only if bbox passes
```

## Running Tests

```bash
npm test
# or individually:
node server/utils/token.test.js     # 12 token tests
node server/utils/geofence.test.js  # 11 geofence tests
```

## Project Structure

```
attendence-proxy/
├── server/
│   ├── server.js               # Express app entry point
│   ├── middleware/auth.js       # JWT + role-guard middleware
│   ├── models/
│   │   ├── User.js             # Teacher + Student (role field)
│   │   ├── Session.js          # Session with per-session HMAC secret
│   │   └── Attendance.js       # Unique compound index (session+student)
│   ├── routes/
│   │   ├── auth.js             # Register / Login
│   │   ├── sessions.js         # Session management + token generation
│   │   └── attendance.js       # Scan endpoint
│   └── utils/
│       ├── token.js            # HMAC token gen/verify
│       ├── token.test.js
│       ├── geofence.js         # Bounding-box + Haversine
│       └── geofence.test.js
└── public/
    ├── index.html              # Login / Register
    ├── teacher.html            # Dashboard: QR display + live list
    ├── student.html            # Camera scanner + submit
    ├── css/style.css           # Dark glassmorphism design system
    └── js/
        ├── auth.js
        ├── teacher.js
        └── student.js
```
