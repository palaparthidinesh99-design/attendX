const { query } = require('../config/db');
const { verifyToken } = require('../utils/token');
const { haversineMeters } = require('../utils/geofence');

// POST /api/attendance/scan — Student scans QR code
async function scanAttendance(req, res, next) {
  try {
    const { sessionId, token, lat, lng, accuracyMeters } = req.body;

    if (!sessionId || !token || lat == null || lng == null) {
      return res.status(400).json({ error: 'sessionId, token, lat and lng are required' });
    }

    const studentLat = parseFloat(lat);
    const studentLng = parseFloat(lng);

    if (isNaN(studentLat) || isNaN(studentLng) || studentLat < -90 || studentLat > 90 || studentLng < -180 || studentLng > 180) {
      return res.status(400).json({ error: 'Invalid coordinates range' });
    }

    // CHECK 1: Session exists and is active
    const sessionRes = await query(
      `SELECT s.*, c.course_code, c.name as course_name
       FROM sessions s
       JOIN courses c ON s.course_id = c.id
       WHERE s.id = $1`,
      [sessionId]
    );

    if (sessionRes.rows.length === 0 || !sessionRes.rows[0].is_active) {
      return res.status(400).json({ error: 'Session is not active or has been ended by the teacher' });
    }

    const session = sessionRes.rows[0];

    // CHECK 1.5: Student enrollment check
    const enrollRes = await query(
      'SELECT 1 FROM enrollments WHERE course_id = $1 AND student_id = $2',
      [session.course_id, req.user.id]
    );

    if (enrollRes.rows.length === 0) {
      return res.status(403).json({
        error: `Access denied: Your email (${req.user.email}) is not enrolled in ${session.course_code}`
      });
    }

    // CHECK 2: Token verification (HMAC)
    if (!verifyToken(session.id, session.qr_secret_encrypted, token)) {
      return res.status(401).json({ error: 'Invalid or expired QR code' });
    }

    // CHECK 3: Geofence verification
    const distanceMeters = haversineMeters(
      studentLat, studentLng,
      session.latitude, session.longitude
    );

    const deviceAccuracy = (accuracyMeters != null && !isNaN(parseFloat(accuracyMeters))) ? parseFloat(accuracyMeters) : 15;
    const accuracyBuffer = Math.min(Math.max(deviceAccuracy, 10), 50);
    const allowedRadius = (session.radius_meters || 50) + accuracyBuffer;

    if (distanceMeters > allowedRadius) {
      return res.status(403).json({
        error: `Outside allowed geofence (${Math.round(distanceMeters)}m away; allowed radius is ${Math.round(allowedRadius)}m incl. ${Math.round(accuracyBuffer)}m GPS buffer)`,
        distanceMeters: Math.round(distanceMeters),
        allowedRadius: Math.round(allowedRadius)
      });
    }

    // CHECK 4: Record attendance
    try {
      const now = new Date();
      const insertRes = await query(
        `INSERT INTO attendance (session_id, student_id, marked_at, status, distance_meters)
         VALUES ($1, $2, $3, 'present', $4)
         RETURNING *`,
        [session.id, req.user.id, now, Math.round(distanceMeters)]
      );

      const record = insertRes.rows[0];

      res.json({
        success: true,
        message: 'Attendance marked successfully',
        record: {
          sessionId: record.session_id,
          _id: record.id,
          id: record.id,
          status: record.status,
          dateString: now.toISOString().split('T')[0],
          timeString: now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }),
          distanceMeters: record.distance_meters
        }
      });
    } catch (dbErr) {
      if (dbErr.code === '23505') {
        return res.status(409).json({ error: 'Attendance already marked for this session' });
      }
      throw dbErr;
    }
  } catch (err) {
    next(err);
  }
}

// GET /api/attendance/my — Student's attendance records
async function getMyAttendance(req, res, next) {
  try {
    const result = await query(
      `SELECT a.id, a.session_id, a.marked_at, a.distance_meters, a.status,
              s.starts_at, s.is_active, c.name as class_name, c.course_code
       FROM attendance a
       JOIN sessions s ON a.session_id = s.id
       JOIN courses c ON s.course_id = c.id
       WHERE a.student_id = $1
       ORDER BY a.marked_at DESC
       LIMIT 50`,
      [req.user.id]
    );

    const history = result.rows.map(r => ({
      id: r.id,
      session: {
        id: r.session_id,
        className: r.class_name,
        courseCode: r.course_code,
        startTime: r.starts_at,
        active: r.is_active
      },
      timestamp: r.marked_at,
      status: r.status,
      distanceMeters: r.distance_meters
    }));

    res.json(history);
  } catch (err) {
    next(err);
  }
}

// GET /api/attendance/analytics — Student analytics & calendar view
async function getStudentAnalytics(req, res, next) {
  try {
    // 1. Fetch student's enrolled courses
    const coursesRes = await query(
      `SELECT c.id, c.name, c.course_code, u.name as teacher_name
       FROM courses c
       JOIN enrollments e ON c.id = e.course_id
       JOIN users u ON c.teacher_id = u.id
       WHERE e.student_id = $1
       ORDER BY e.enrolled_at DESC`,
      [req.user.id]
    );

    const courses = coursesRes.rows;
    if (courses.length === 0) {
      return res.json({
        studentName: req.user.name,
        studentEmail: req.user.email,
        subjects: [],
        sessionsByDate: {}
      });
    }

    const courseIds = courses.map(c => c.id);

    // 2. Fetch all attended session IDs by this student
    const attendedRes = await query(
      'SELECT session_id, distance_meters, marked_at FROM attendance WHERE student_id = $1',
      [req.user.id]
    );
    const attendedMap = new Map();
    attendedRes.rows.forEach(r => attendedMap.set(r.session_id, r));

    // 3. Compute stats for each course
    const subjects = await Promise.all(courses.map(async (c) => {
      const sessionsRes = await query(
        'SELECT id, is_active FROM sessions WHERE course_id = $1',
        [c.id]
      );
      const allSessions = sessionsRes.rows;
      const endedSessions = allSessions.filter(s => !s.is_active);

      let attendedCount = 0;
      allSessions.forEach(s => {
        if (attendedMap.has(s.id)) {
          attendedCount++;
        }
      });

      const totalEnded = endedSessions.length;
      const percentage = totalEnded > 0
        ? Math.min(100, Math.round((attendedCount / totalEnded) * 100))
        : 100;

      return {
        courseId: c.id,
        _id: c.id,
        courseCode: c.course_code,
        courseName: c.name,
        teacherName: c.teacher_name || 'Instructor',
        attendedSessions: attendedCount,
        totalEndedSessions: totalEnded,
        totalSessions: allSessions.length,
        minAttendancePercentage: 75,
        percentage,
        isEligible: percentage >= 75
      };
    }));

    // 4. Build sessions grouped by date
    const allSessionsRes = await query(
      `SELECT s.id, s.starts_at, s.is_active, s.course_id,
              c.course_code, c.name as course_name, u.name as teacher_name
       FROM sessions s
       JOIN courses c ON s.course_id = c.id
       JOIN users u ON c.teacher_id = u.id
       WHERE s.course_id = ANY($1)
       ORDER BY s.starts_at DESC`,
      [courseIds]
    );

    const sessionsByDate = {};
    for (const s of allSessionsRes.rows) {
      const dateObj = new Date(s.starts_at);
      const dateStr = dateObj.toISOString().split('T')[0];
      const isAttended = attendedMap.has(s.id);
      const attRecord = attendedMap.get(s.id);

      let status = 'ABSENT';
      if (isAttended) {
        status = 'PRESENT';
      } else if (s.is_active) {
        status = 'ONGOING';
      }

      const sessionItem = {
        sessionId: s.id,
        courseCode: s.course_code,
        courseName: s.course_name,
        className: s.course_name,
        teacherName: s.teacher_name,
        startTime: s.starts_at,
        active: s.is_active,
        timeString: dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status,
        distanceMeters: attRecord ? attRecord.distance_meters : null
      };

      if (!sessionsByDate[dateStr]) {
        sessionsByDate[dateStr] = [];
      }
      sessionsByDate[dateStr].push(sessionItem);
    }

    res.json({
      studentName: req.user.name,
      studentEmail: req.user.email,
      subjects,
      sessionsByDate
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  scanAttendance,
  getMyAttendance,
  getStudentAnalytics
};
