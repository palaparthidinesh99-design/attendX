const express = require('express');
const Session = require('../models/Session');
const Attendance = require('../models/Attendance');
const { authenticate, requireRole } = require('../middleware/auth');
const { verifyToken } = require('../utils/token');
const { isWithinRadius, haversineMeters } = require('../utils/geofence');

const router = express.Router();

// POST /api/attendance/scan
router.post('/scan', authenticate, requireRole('student'), async (req, res, next) => {
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

    // --- CHECK 1: Session exists and is active ---
    const session = await Session.findById(sessionId);
    if (!session || !session.active) {
      return res.status(400).json({ error: 'Session is not active or has been ended by the teacher' });
    }

    // --- CHECK 1.5: Course Enrollment Check ---
    if (session.courseId) {
      const Course = require('../models/Course');
      const course = await Course.findById(session.courseId);
      if (course) {
        const isStudentEnrolled =
          course.enrolledStudents.some(id => id.toString() === req.user._id.toString()) ||
          course.enrolledEmails.includes(req.user.email.toLowerCase());

        if (!isStudentEnrolled) {
          return res.status(403).json({
            error: `Access denied: Your email (${req.user.email}) is not enrolled in ${course.courseCode}`
          });
        }
      }
    }

    // --- CHECK 2: Token validity (HMAC, no DB read) ---
    if (!verifyToken(session._id.toString(), session.secret, token)) {
      return res.status(401).json({ error: 'Invalid or expired QR code' });
    }

    // --- CHECK 3: Geofence Verification ---
    // Laptop Wi-Fi / IP positioning can differ from mobile phone GPS by 150-250m.
    // We calculate Haversine distance and provide a tolerance buffer for device variance.
    const distanceMeters = haversineMeters(
      studentLat, studentLng,
      session.location.lat, session.location.lng
    );

    const deviceAccuracy = (accuracyMeters != null && !isNaN(parseFloat(accuracyMeters))) ? parseFloat(accuracyMeters) : 15;
    // Strict 10m - 50m maximum GPS accuracy buffer
    const accuracyBuffer = Math.min(Math.max(deviceAccuracy, 10), 50);
    const allowedRadius = session.radiusMeters + accuracyBuffer;

    if (distanceMeters > allowedRadius) {
      return res.status(403).json({
        error: `Outside allowed geofence (${Math.round(distanceMeters)}m away; allowed radius is ${Math.round(allowedRadius)}m incl. ${Math.round(accuracyBuffer)}m GPS buffer)`,
        distanceMeters: Math.round(distanceMeters),
        allowedRadius: Math.round(allowedRadius)
      });
    }

    // --- CHECK 4: DB write — unique index rejects duplicates ---
    try {
      const now = new Date();
      const dateString = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      const timeString = now.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: true }) + ' IST';

      const record = await Attendance.create({
        sessionId: session._id,
        courseId: session.courseId?._id || session.courseId,
        studentId: req.user._id,
        status: 'PRESENT',
        generatedBy: 'SCAN',
        dateString,
        timeString,
        distanceMeters: Math.round(distanceMeters)
      });

      res.json({
        success: true,
        message: 'Attendance marked successfully',
        record: {
          sessionId: record.sessionId,
          status: record.status,
          dateString: record.dateString,
          timeString: record.timeString,
          distanceMeters: record.distanceMeters
        }
      });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ error: 'Attendance already marked for this session' });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

// GET /api/attendance/my — Student's own attendance history
router.get('/my', authenticate, requireRole('student'), async (req, res, next) => {
  try {
    const records = await Attendance.find({ studentId: req.user._id })
      .populate('sessionId', 'className startTime active')
      .sort({ timestamp: -1 })
      .limit(50);

    res.json(records.map(r => ({
      session: r.sessionId,
      timestamp: r.timestamp,
      distanceMeters: r.distanceMeters
    })));
  } catch (err) {
    next(err);
  }
});

// GET /api/attendance/analytics — Student's subject-wise percentage & calendar breakdown
router.get('/analytics', authenticate, requireRole('student'), async (req, res, next) => {
  try {
    const Course = require('../models/Course');
    const Enrollment = require('../models/Enrollment');

    // 1. Query enrolled courses via Enrollment join collection
    const enrollments = await Enrollment.find({ studentId: req.user._id, status: 'ACTIVE' }).populate({
      path: 'courseId',
      populate: { path: 'teacherId', select: 'name email' }
    });

    let courses = enrollments.map(e => e.courseId).filter(Boolean);

    // Fallback: Also search by email in Course.enrolledEmails
    const legacyCourses = await Course.find({
      $or: [
        { enrolledStudents: req.user._id },
        { enrolledEmails: req.user.email.toLowerCase() }
      ]
    }).populate('teacherId', 'name email');

    const courseMap = new Map();
    courses.concat(legacyCourses).forEach(c => {
      if (c && c._id) courseMap.set(c._id.toString(), c);
    });
    courses = Array.from(courseMap.values());

    // 2. Fetch all student attendance records
    const myAttendance = await Attendance.find({ studentId: req.user._id })
      .populate({
        path: 'sessionId',
        select: 'className startTime courseId location active'
      })
      .sort({ timestamp: -1 });

    const attendedSessionIds = new Set(myAttendance.map(a => a.sessionId?._id?.toString()).filter(Boolean));

    // 3. Compute stats for each course (percentage based on ENDED sessions)
    const subjects = await Promise.all(courses.map(async (c) => {
      const courseSessions = await Session.find({ courseId: c._id });
      const endedSessions = courseSessions.filter(s => !s.active);

      let attendedCount = 0;
      courseSessions.forEach(s => {
        if (attendedSessionIds.has(s._id.toString())) {
          attendedCount++;
        }
      });

      // Calculate percentage based on ended sessions (ongoing classes do not lower percentage)
      const totalEndedCount = endedSessions.length;
      const percentage = totalEndedCount > 0
        ? Math.min(100, Math.round((attendedCount / totalEndedCount) * 100))
        : 100;

      return {
        courseId: c._id,
        courseCode: c.courseCode,
        courseName: c.courseName,
        teacherName: c.teacherId?.name || 'Instructor',
        attendedSessions: attendedCount,
        totalEndedSessions: totalEndedCount,
        totalSessions: courseSessions.length,
        percentage,
        isEligible: percentage >= 75
      };
    }));

    // 4. Format date-grouped class sessions (Missed ❌ ONLY after session ends; ONGOING ▶ while live)
    const sessionsByDate = {};

    for (let course of courses) {
      const courseSessions = await Session.find({ courseId: course._id }).sort({ startTime: -1 });
      for (let s of courseSessions) {
        const sId = s._id.toString();
        const dateObj = new Date(s.startTime);
        const dateStr = dateObj.toISOString().split('T')[0];
        const isAttended = attendedSessionIds.has(sId);
        const attendanceRecord = isAttended ? myAttendance.find(a => a.sessionId?._id?.toString() === sId) : null;

        // Status logic: PRESENT (Attended ✓), ONGOING (Live Class ▶), ABSENT (Missed ❌ - ONLY after teacher ends)
        let status = 'ABSENT';
        if (isAttended) {
          status = 'PRESENT';
        } else if (s.active) {
          status = 'ONGOING';
        }

        const sessionItem = {
          sessionId: s._id,
          courseCode: course.courseCode,
          courseName: course.courseName,
          className: s.className,
          teacherName: course.teacherId?.name || 'Instructor',
          startTime: s.startTime,
          active: s.active,
          timeString: dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          status,
          distanceMeters: attendanceRecord ? attendanceRecord.distanceMeters : null
        };

        if (!sessionsByDate[dateStr]) {
          sessionsByDate[dateStr] = [];
        }
        sessionsByDate[dateStr].push(sessionItem);
      }
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
});

module.exports = router;
