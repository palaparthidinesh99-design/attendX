const crypto = require('crypto');
const { query } = require('../config/db');
const { generateToken } = require('../utils/token');

// POST /api/sessions — Teacher creates new session
async function createSession(req, res, next) {
  try {
    const { className, lat, lng, radiusMeters, courseId } = req.body;

    if (!className || lat == null || lng == null) {
      return res.status(400).json({ error: 'className, lat and lng are required' });
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    const radius = radiusMeters ? parseInt(radiusMeters, 10) : 50;

    if (isNaN(latitude) || isNaN(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return res.status(400).json({ error: 'Invalid coordinates' });
    }

    // Determine course_id
    let targetCourseId = courseId;
    if (!targetCourseId) {
      // Find or create a course for this teacher
      const existingCourse = await query(
        'SELECT id, name FROM courses WHERE teacher_id = $1 ORDER BY created_at DESC LIMIT 1',
        [req.user.id]
      );
      if (existingCourse.rows.length > 0) {
        targetCourseId = existingCourse.rows[0].id;
      } else {
        const newCourse = await query(
          `INSERT INTO courses (name, course_code, teacher_id)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [className.trim(), 'GEN-' + crypto.randomBytes(2).toString('hex').toUpperCase(), req.user.id]
        );
        targetCourseId = newCourse.rows[0].id;
      }
    } else {
      // Verify course exists
      const courseCheck = await query(
        'SELECT id, name FROM courses WHERE id = $1 AND teacher_id = $2',
        [targetCourseId, req.user.id]
      );
      if (courseCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Selected course not found or unauthorized' });
      }
    }

    // Deactivate previous active sessions for this teacher
    await query(
      `UPDATE sessions
       SET is_active = FALSE, ends_at = CASE WHEN NOW() > starts_at THEN NOW() ELSE starts_at + interval '1 second' END
       WHERE created_by = $1 AND is_active = TRUE`,
      [req.user.id]
    );

    const secret = crypto.randomBytes(32).toString('hex');
    const startsAt = new Date();
    // Default ends_at 4 hours later to satisfy CHECK (starts_at < ends_at)
    const endsAt = new Date(startsAt.getTime() + 4 * 60 * 60 * 1000);

    const result = await query(
      `INSERT INTO sessions (course_id, created_by, starts_at, ends_at, latitude, longitude, radius_meters, qr_secret_encrypted, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
       RETURNING *`,
      [targetCourseId, req.user.id, startsAt, endsAt, latitude, longitude, radius, secret]
    );

    const session = result.rows[0];

    res.status(201).json({
      sessionId: session.id,
      _id: session.id,
      id: session.id,
      className: className.trim(),
      courseId: session.course_id,
      location: { lat: session.latitude, lng: session.longitude },
      radiusMeters: session.radius_meters,
      startTime: session.starts_at,
      startsAt: session.starts_at,
      active: session.is_active
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/sessions/:id/token — Current rotating QR token
async function getSessionToken(req, res, next) {
  try {
    const result = await query(
      'SELECT id, qr_secret_encrypted, is_active FROM sessions WHERE id = $1',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = result.rows[0];
    if (!session.is_active) {
      return res.status(400).json({ error: 'Session is not active' });
    }

    const token = generateToken(session.id, session.qr_secret_encrypted);
    const qrPayload = JSON.stringify({
      sessionId: session.id,
      token
    });

    res.json({
      token,
      qrPayload,
      windowExpiresIn: 15000 - (Date.now() % 15000)
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/sessions/:id/attendance — Live attendance list for teacher
async function getSessionAttendance(req, res, next) {
  try {
    const sessionRes = await query(
      `SELECT s.*, c.name as course_name
       FROM sessions s
       JOIN courses c ON s.course_id = c.id
       WHERE s.id = $1`,
      [req.params.id]
    );

    if (sessionRes.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessionRes.rows[0];
    if (session.created_by !== req.user.id) {
      return res.status(403).json({ error: 'Not your session' });
    }

    const recordsRes = await query(
      `SELECT a.id, a.marked_at, a.status, a.distance_meters,
              u.id as student_id, u.name as student_name, u.email as student_email
       FROM attendance a
       JOIN users u ON a.student_id = u.id
       WHERE a.session_id = $1
       ORDER BY a.marked_at DESC`,
      [session.id]
    );

    const records = recordsRes.rows.map(r => ({
      id: r.id,
      _id: r.id,
      student: {
        id: r.student_id,
        _id: r.student_id,
        name: r.student_name,
        email: r.student_email
      },
      timestamp: r.marked_at,
      status: r.status,
      distanceMeters: r.distance_meters
    }));

    res.json({
      sessionId: session.id,
      _id: session.id,
      className: session.course_name,
      active: session.is_active,
      count: records.length,
      records
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/sessions/:id/end — End active session
async function endSession(req, res, next) {
  try {
    const result = await query(
      `UPDATE sessions
       SET is_active = FALSE, ends_at = CASE WHEN NOW() > starts_at THEN NOW() ELSE starts_at + interval '1 second' END
       WHERE id = $1 AND created_by = $2
       RETURNING *`,
      [req.params.id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found or not created by you' });
    }

    res.json({ message: 'Session ended successfully', session: result.rows[0] });
  } catch (err) {
    next(err);
  }
}

// GET /api/sessions — List teacher's sessions
async function getTeacherSessions(req, res, next) {
  try {
    const result = await query(
      `SELECT s.id, s.course_id, s.starts_at, s.ends_at, s.latitude, s.longitude,
              s.radius_meters, s.is_active, s.created_at,
              c.name as course_name, c.course_code
       FROM sessions s
       JOIN courses c ON s.course_id = c.id
       WHERE s.created_by = $1
       ORDER BY s.starts_at DESC
       LIMIT 20`,
      [req.user.id]
    );

    const sessions = result.rows.map(s => ({
      id: s.id,
      _id: s.id,
      sessionId: s.id,
      courseId: s.course_id,
      className: s.course_name,
      courseName: s.course_name,
      courseCode: s.course_code,
      location: { lat: s.latitude, lng: s.longitude },
      radiusMeters: s.radius_meters,
      startTime: s.starts_at,
      startsAt: s.starts_at,
      endTime: s.ends_at,
      endsAt: s.ends_at,
      active: s.is_active
    }));

    res.json(sessions);
  } catch (err) {
    next(err);
  }
}

// GET /api/sessions/:id/export-csv — CSV export for single session (Names on rows, session date column, P or A for each enrolled student)
async function exportSessionAttendanceCSV(req, res, next) {
  try {
    const sessionRes = await query(
      `SELECT s.*, c.course_code, c.name as course_name
       FROM sessions s
       JOIN courses c ON s.course_id = c.id
       WHERE s.id = $1`,
      [req.params.id]
    );

    if (sessionRes.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessionRes.rows[0];
    if (session.created_by !== req.user.id) {
      return res.status(403).json({ error: 'Not your session' });
    }

    // 1. Fetch all enrolled students (and attendees)
    const studentsRes = await query(
      `SELECT DISTINCT u.id, u.name, u.email
       FROM users u
       LEFT JOIN enrollments e ON e.student_id = u.id AND e.course_id = $1
       LEFT JOIN attendance a ON a.student_id = u.id AND a.session_id = $2
       WHERE e.course_id = $1 OR a.session_id = $2
       ORDER BY u.name ASC`,
      [session.course_id, session.id]
    );
    const students = studentsRes.rows;

    // 2. Fetch attendance records for this session
    const attRes = await query(
      `SELECT student_id, status FROM attendance WHERE session_id = $1`,
      [session.id]
    );
    const presentSet = new Set(
      attRes.rows.filter(r => r.status === 'present').map(r => r.student_id)
    );

    const sessionDate = new Date(session.starts_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=attendance_${session.course_code}_${sessionDate}.csv`);
    res.write(`Student Name,Student Email,${sessionDate}\n`);

    for (const student of students) {
      const name = `"${(student.name || 'Unknown').replace(/"/g, '""')}"`;
      const email = `"${(student.email || '').replace(/"/g, '""')}"`;
      const status = presentSet.has(student.id) ? 'P' : 'A';
      res.write(`${name},${email},${status}\n`);
    }

    res.end();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createSession,
  getSessionToken,
  getSessionAttendance,
  endSession,
  getTeacherSessions,
  exportSessionAttendanceCSV
};
