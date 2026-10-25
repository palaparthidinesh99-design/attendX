const { query } = require('../config/db');

// POST /api/courses — Teacher creates course
async function createCourse(req, res, next) {
  try {
    const { courseCode, courseName } = req.body;

    if (!courseCode || !courseName) {
      return res.status(400).json({ error: 'courseCode and courseName are required' });
    }

    const cleanCode = String(courseCode).trim().toUpperCase();
    const cleanName = String(courseName).trim();

    const existing = await query('SELECT id FROM courses WHERE UPPER(course_code) = $1', [cleanCode]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: `Course with code ${cleanCode} already exists` });
    }

    const result = await query(
      `INSERT INTO courses (name, course_code, teacher_id)
       VALUES ($1, $2, $3)
       RETURNING id, name, course_code, teacher_id, created_at`,
      [cleanName, cleanCode, req.user.id]
    );

    const c = result.rows[0];
    res.status(201).json({
      id: c.id,
      _id: c.id,
      name: c.name,
      courseName: c.name,
      courseCode: c.course_code,
      teacherId: c.teacher_id,
      createdAt: c.created_at,
      enrolledCount: 0
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A course with this code already exists' });
    }
    next(err);
  }
}

// GET /api/courses — List teacher's courses or student's enrolled courses
async function getCourses(req, res, next) {
  try {
    const role = String(req.user.role).toLowerCase();

    if (role === 'teacher') {
      const result = await query(
        `SELECT c.id, c.name, c.course_code, c.teacher_id, c.created_at,
                (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS enrolled_count
         FROM courses c
         WHERE c.teacher_id = $1
         ORDER BY c.created_at DESC`,
        [req.user.id]
      );

      const courses = result.rows.map(r => ({
        id: r.id,
        _id: r.id,
        name: r.name,
        courseName: r.name,
        courseCode: r.course_code,
        teacherId: r.teacher_id,
        enrolledCount: parseInt(r.enrolled_count || 0, 10),
        createdAt: r.created_at
      }));

      return res.json(courses);
    } else {
      // Student: list enrolled courses
      const result = await query(
        `SELECT c.id, c.name, c.course_code, c.teacher_id, c.created_at,
                u.name AS teacher_name, u.email AS teacher_email
         FROM courses c
         JOIN enrollments e ON c.id = e.course_id
         JOIN users u ON c.teacher_id = u.id
         WHERE e.student_id = $1
         ORDER BY e.enrolled_at DESC`,
        [req.user.id]
      );

      const courses = result.rows.map(r => ({
        id: r.id,
        _id: r.id,
        name: r.name,
        courseName: r.name,
        courseCode: r.course_code,
        teacherId: {
          id: r.teacher_id,
          name: r.teacher_name,
          email: r.teacher_email
        },
        teacherName: r.teacher_name,
        createdAt: r.created_at
      }));

      return res.json(courses);
    }
  } catch (err) {
    next(err);
  }
}

// GET /api/courses/:id/students — Course roster & enrolled students
async function getCourseStudents(req, res, next) {
  try {
    const courseRes = await query(
      'SELECT id, name, course_code, teacher_id FROM courses WHERE id = $1 AND teacher_id = $2',
      [req.params.id, req.user.id]
    );

    if (courseRes.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found or unauthorized' });
    }

    const course = courseRes.rows[0];

    const studentRes = await query(
      `SELECT u.id, u.name, u.email
       FROM users u
       JOIN enrollments e ON u.id = e.student_id
       WHERE e.course_id = $1
       ORDER BY u.name ASC`,
      [course.id]
    );

    const students = studentRes.rows.map(s => ({
      id: s.id,
      _id: s.id,
      name: s.name,
      email: s.email
    }));

    const emails = students.map(s => s.email.toLowerCase());

    res.json({
      courseId: course.id,
      _id: course.id,
      courseCode: course.course_code,
      courseName: course.name,
      name: course.name,
      enrolledCount: students.length,
      enrolledEmails: emails,
      enrolledStudents: students
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/courses/:id/enroll — Teacher enrolls students by email list
async function enrollStudents(req, res, next) {
  try {
    const { emails } = req.body;
    if (!emails) {
      return res.status(400).json({ error: 'Student email(s) required' });
    }

    const courseRes = await query(
      'SELECT id FROM courses WHERE id = $1 AND teacher_id = $2',
      [req.params.id, req.user.id]
    );

    if (courseRes.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found or unauthorized' });
    }

    const courseId = courseRes.rows[0].id;

    let emailList = [];
    if (Array.isArray(emails)) {
      emailList = emails.map(e => String(e).trim().toLowerCase()).filter(Boolean);
    } else if (typeof emails === 'string') {
      emailList = emails.split(/[\n,;]+/).map(e => String(e).trim().toLowerCase()).filter(Boolean);
    }

    if (emailList.length === 0) {
      return res.status(400).json({ error: 'No valid emails provided' });
    }

    // Enroll students matching these emails
    let enrolledCount = 0;
    for (const email of emailList) {
      const userRes = await query(
        'SELECT id FROM users WHERE LOWER(email) = $1 AND role = $2',
        [email, 'student']
      );

      if (userRes.rows.length > 0) {
        const studentId = userRes.rows[0].id;
        await query(
          `INSERT INTO enrollments (course_id, student_id)
           VALUES ($1, $2)
           ON CONFLICT (course_id, student_id) DO NOTHING`,
          [courseId, studentId]
        );
        enrolledCount++;
      }
    }

    res.json({ message: `Successfully enrolled ${enrolledCount} student(s)` });
  } catch (err) {
    next(err);
  }
}

// POST /api/courses/join — Student joins course by course code or id
async function joinCourse(req, res, next) {
  try {
    const { joinCode } = req.body;
    if (!joinCode) {
      return res.status(400).json({ error: 'Course code or join code required' });
    }

    const cleanCode = String(joinCode).trim().toUpperCase();

    // Check by course_code or UUID
    const courseRes = await query(
      'SELECT id, name, course_code FROM courses WHERE UPPER(course_code) = $1 OR id::text = $2',
      [cleanCode, joinCode.trim()]
    );

    if (courseRes.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid course code' });
    }

    const course = courseRes.rows[0];

    await query(
      `INSERT INTO enrollments (course_id, student_id)
       VALUES ($1, $2)
       ON CONFLICT (course_id, student_id) DO NOTHING`,
      [course.id, req.user.id]
    );

    res.json({
      message: `Successfully joined ${course.course_code} (${course.name})`,
      course: {
        id: course.id,
        _id: course.id,
        courseCode: course.course_code,
        courseName: course.name,
        name: course.name
      }
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/courses/:id/export-csv — Streamed CSV export for course
async function exportCourseCSV(req, res, next) {
  try {
    const courseRes = await query(
      'SELECT id, name, course_code FROM courses WHERE id = $1 AND teacher_id = $2',
      [req.params.id, req.user.id]
    );

    if (courseRes.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found or unauthorized' });
    }

    const course = courseRes.rows[0];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=attendance_${course.course_code}.csv`);
    res.write('Student Name,Student Email,Status,Marked At (IST),Distance (m)\n');

    const result = await query(
      `SELECT a.status, a.marked_at, a.distance_meters, u.name, u.email
       FROM attendance a
       JOIN users u ON a.student_id = u.id
       JOIN sessions s ON a.session_id = s.id
       WHERE s.course_id = $1
       ORDER BY a.marked_at DESC`,
      [course.id]
    );

    for (const row of result.rows) {
      const name = `"${(row.name || '').replace(/"/g, '""')}"`;
      const email = `"${(row.email || '').replace(/"/g, '""')}"`;
      const time = row.marked_at ? new Date(row.marked_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A';
      const dist = row.distance_meters != null ? `${row.distance_meters}m` : 'N/A';
      res.write(`${name},${email},${row.status},"${time}","${dist}"\n`);
    }

    res.end();
  } catch (err) {
    next(err);
  }
}

// GET /api/courses/sessions/:sessionId/export — Streamed CSV export for single session
async function exportSessionCSV(req, res, next) {
  try {
    const sessionRes = await query(
      `SELECT s.id, s.starts_at, c.course_code, c.name as course_name
       FROM sessions s
       JOIN courses c ON s.course_id = c.id
       WHERE s.id = $1`,
      [req.params.sessionId]
    );

    if (sessionRes.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessionRes.rows[0];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=attendance_${session.course_code}_${session.id}.csv`);
    res.write('Student Name,Student Email,Status,Marked At (IST),Distance (m)\n');

    const result = await query(
      `SELECT a.status, a.marked_at, a.distance_meters, u.name, u.email
       FROM attendance a
       JOIN users u ON a.student_id = u.id
       WHERE a.session_id = $1
       ORDER BY a.marked_at ASC`,
      [session.id]
    );

    for (const row of result.rows) {
      const name = `"${(row.name || '').replace(/"/g, '""')}"`;
      const email = `"${(row.email || '').replace(/"/g, '""')}"`;
      const time = row.marked_at ? new Date(row.marked_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A';
      const dist = row.distance_meters != null ? `${row.distance_meters}m` : 'N/A';
      res.write(`${name},${email},${row.status},"${time}","${dist}"\n`);
    }

    res.end();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createCourse,
  getCourses,
  getCourseStudents,
  enrollStudents,
  joinCourse,
  exportCourseCSV,
  exportSessionCSV
};
