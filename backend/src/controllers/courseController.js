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

// GET /api/courses/:id/attendance-matrix — View full attendance table (Names on rows, session dates on columns, P or A)
async function getCourseAttendanceMatrix(req, res, next) {
  try {
    const courseRes = await query(
      'SELECT id, name, course_code FROM courses WHERE id = $1 AND teacher_id = $2',
      [req.params.id, req.user.id]
    );

    if (courseRes.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found or unauthorized' });
    }

    const course = courseRes.rows[0];

    // 1. All sessions for course ordered chronologically
    const sessionsRes = await query(
      'SELECT id, starts_at, ends_at, is_active FROM sessions WHERE course_id = $1 ORDER BY starts_at ASC',
      [course.id]
    );

    const dateCounts = {};
    const sessions = sessionsRes.rows.map((s) => {
      const dStr = new Date(s.starts_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      dateCounts[dStr] = (dateCounts[dStr] || 0) + 1;
      return {
        id: s.id,
        startsAt: s.starts_at,
        endsAt: s.ends_at,
        isActive: s.is_active,
        date: dStr
      };
    });

    const seenDates = {};
    const formattedSessions = sessions.map((s) => {
      seenDates[s.date] = (seenDates[s.date] || 0) + 1;
      const label = dateCounts[s.date] > 1 ? `${s.date} (#${seenDates[s.date]})` : s.date;
      return { ...s, label };
    });

    // 2. All enrolled students
    const studentsRes = await query(
      `SELECT DISTINCT u.id, u.name, u.email
       FROM users u
       LEFT JOIN enrollments e ON e.student_id = u.id AND e.course_id = $1
       LEFT JOIN attendance a ON a.student_id = u.id
       LEFT JOIN sessions s ON a.session_id = s.id AND s.course_id = $1
       WHERE e.course_id = $1 OR s.course_id = $1
       ORDER BY u.name ASC`,
      [course.id]
    );

    // 3. All attendance records
    const attRes = await query(
      `SELECT a.session_id, a.student_id, a.status
       FROM attendance a
       JOIN sessions s ON a.session_id = s.id
       WHERE s.course_id = $1`,
      [course.id]
    );

    const attendanceMap = new Set();
    for (const row of attRes.rows) {
      if (row.status === 'present') {
        attendanceMap.add(`${row.session_id}_${row.student_id}`);
      }
    }

    // 4. Assemble student rows
    const students = studentsRes.rows.map((st) => {
      let presentCount = 0;
      const records = {};
      for (const sess of formattedSessions) {
        const isPresent = attendanceMap.has(`${sess.id}_${st.id}`);
        if (isPresent) {
          presentCount++;
          records[sess.id] = 'P';
        } else {
          records[sess.id] = 'A';
        }
      }

      const total = formattedSessions.length;
      const percentage = total > 0 ? Math.round((presentCount / total) * 100) : 100;

      return {
        id: st.id,
        name: st.name,
        email: st.email,
        records,
        presentCount,
        totalSessions: total,
        percentage
      };
    });

    res.json({
      course: {
        id: course.id,
        name: course.name,
        courseCode: course.course_code
      },
      sessions: formattedSessions,
      students
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/courses/:id/export-csv — Full Attendance Register Matrix CSV (Names on rows, Dates as columns, P or A)
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

    // 1. Fetch all sessions for this course ordered chronologically
    const sessionsRes = await query(
      'SELECT id, starts_at, ends_at FROM sessions WHERE course_id = $1 ORDER BY starts_at ASC',
      [course.id]
    );
    const sessions = sessionsRes.rows;

    // 2. Fetch all enrolled students
    const studentsRes = await query(
      `SELECT DISTINCT u.id, u.name, u.email
       FROM users u
       LEFT JOIN enrollments e ON e.student_id = u.id AND e.course_id = $1
       LEFT JOIN attendance a ON a.student_id = u.id
       LEFT JOIN sessions s ON a.session_id = s.id AND s.course_id = $1
       WHERE e.course_id = $1 OR s.course_id = $1
       ORDER BY u.name ASC`,
      [course.id]
    );
    const students = studentsRes.rows;

    // 3. Fetch all attendance records
    const attRes = await query(
      `SELECT a.session_id, a.student_id, a.status
       FROM attendance a
       JOIN sessions s ON a.session_id = s.id
       WHERE s.course_id = $1`,
      [course.id]
    );

    const attendanceMap = new Set();
    for (const row of attRes.rows) {
      if (row.status === 'present') {
        attendanceMap.add(`${row.session_id}_${row.student_id}`);
      }
    }

    // 4. Generate column headers for dates
    const dateCounts = {};
    const sessionDateLabels = sessions.map((sess) => {
      const dStr = new Date(sess.starts_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      dateCounts[dStr] = (dateCounts[dStr] || 0) + 1;
      return { id: sess.id, dateStr: dStr };
    });

    const seenDates = {};
    const dateHeaders = sessionDateLabels.map((item) => {
      seenDates[item.dateStr] = (seenDates[item.dateStr] || 0) + 1;
      if (dateCounts[item.dateStr] > 1) {
        return `${item.dateStr} (#${seenDates[item.dateStr]})`;
      }
      return item.dateStr;
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=attendance_${course.course_code}_register.csv`);

    // Write CSV Header
    if (dateHeaders.length > 0) {
      res.write(`Student Name,Student Email,${dateHeaders.join(',')},Total Present,Total Sessions,Percentage\n`);
    } else {
      res.write('Student Name,Student Email,Total Present,Total Sessions,Percentage\n');
    }

    // Write Student Rows
    for (const student of students) {
      const name = `"${(student.name || 'Unknown').replace(/"/g, '""')}"`;
      const email = `"${(student.email || '').replace(/"/g, '""')}"`;

      let presentCount = 0;
      const statusCols = sessions.map((sess) => {
        const isPresent = attendanceMap.has(`${sess.id}_${student.id}`);
        if (isPresent) {
          presentCount++;
          return 'P';
        }
        return 'A';
      });

      const totalSessions = sessions.length;
      const percentage = totalSessions > 0 ? Math.round((presentCount / totalSessions) * 100) : 100;

      if (statusCols.length > 0) {
        res.write(`${name},${email},${statusCols.join(',')},${presentCount},${totalSessions},${percentage}%\n`);
      } else {
        res.write(`${name},${email},0,0,100%\n`);
      }
    }

    res.end();
  } catch (err) {
    next(err);
  }
}

// GET /api/courses/sessions/:sessionId/export — CSV export for single session (P or A per enrolled student)
async function exportSessionCSV(req, res, next) {
  try {
    const sessionRes = await query(
      `SELECT s.id, s.course_id, s.starts_at, c.course_code, c.name as course_name
       FROM sessions s
       JOIN courses c ON s.course_id = c.id
       WHERE s.id = $1`,
      [req.params.sessionId]
    );

    if (sessionRes.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessionRes.rows[0];

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

// GET /api/courses/:id/sessions — List all sessions for a course with attendance summary
async function getCourseSessions(req, res, next) {
  try {
    const courseRes = await query(
      'SELECT id, name, course_code FROM courses WHERE id = $1 AND teacher_id = $2',
      [req.params.id, req.user.id]
    );

    if (courseRes.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found or unauthorized' });
    }

    const enrolledRes = await query(
      'SELECT COUNT(*) as count FROM enrollments WHERE course_id = $1',
      [req.params.id]
    );
    const enrolledCount = parseInt(enrolledRes.rows[0]?.count, 10) || 0;

    const sessionsRes = await query(
      `SELECT s.id, s.starts_at, s.ends_at, s.is_active, s.radius_meters
       FROM sessions s
       WHERE s.course_id = $1
       ORDER BY s.starts_at DESC`,
      [req.params.id]
    );

    const attRes = await query(
      `SELECT a.session_id, COUNT(*) as count
       FROM attendance a
       JOIN sessions s ON a.session_id = s.id
       WHERE s.course_id = $1 AND a.status = 'present'
       GROUP BY a.session_id`,
      [req.params.id]
    );

    const attMap = {};
    for (const r of attRes.rows) {
      attMap[r.session_id] = parseInt(r.count, 10) || 0;
    }

    res.json({
      course: courseRes.rows[0],
      sessions: sessionsRes.rows.map(s => ({
        id: s.id,
        startsAt: s.starts_at,
        endsAt: s.ends_at,
        isActive: s.is_active,
        radiusMeters: s.radius_meters,
        presentCount: attMap[s.id] || 0,
        enrolledCount
      }))
    });
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
  getCourseAttendanceMatrix,
  exportCourseCSV,
  exportSessionCSV,
  getCourseSessions
};

