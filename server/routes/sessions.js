const express = require('express');
const crypto = require('crypto');
const Session = require('../models/Session');
const Attendance = require('../models/Attendance');
const Course = require('../models/Course');
const { authenticate, requireRole } = require('../middleware/auth');
const { generateToken } = require('../utils/token');

const router = express.Router();

// POST /api/sessions — Teacher creates a new session
router.post('/', authenticate, requireRole('teacher'), async (req, res, next) => {
  try {
    const { className, lat, lng, radiusMeters, courseId } = req.body;

    if (!className || lat == null || lng == null) {
      return res.status(400).json({ error: 'className, lat and lng are required' });
    }

    // Deactivate any existing active sessions for this teacher
    await Session.updateMany(
      { teacherId: req.user._id, active: true },
      { active: false, endTime: new Date() }
    );

    const sessionData = {
      teacherId: req.user._id,
      className: className.trim(),
      location: { lat: parseFloat(lat), lng: parseFloat(lng) },
      radiusMeters: radiusMeters ? parseInt(radiusMeters) : 50,
      secret: crypto.randomBytes(32).toString('hex')
    };

    if (courseId) {
      const course = await Course.findOne({ _id: courseId, teacherId: req.user._id });
      if (!course) {
        return res.status(400).json({ error: 'Selected course not found or unauthorized' });
      }
      sessionData.courseId = course._id;
    }

    const session = await Session.create(sessionData);

    res.status(201).json({
      sessionId: session._id,
      className: session.className,
      courseId: session.courseId,
      location: session.location,
      radiusMeters: session.radiusMeters,
      startTime: session.startTime
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/sessions/:id/token — Returns current rotating QR token payload
router.get('/:id/token', async (req, res, next) => {
  try {
    const session = await Session.findById(req.params.id).select('_id secret active');
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!session.active) return res.status(400).json({ error: 'Session is not active' });

    const token = generateToken(session._id.toString(), session.secret);

    const qrPayload = JSON.stringify({
      sessionId: session._id.toString(),
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
});

// GET /api/sessions/:id/attendance — Live attendance list for a session
router.get('/:id/attendance', authenticate, requireRole('teacher'), async (req, res, next) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    if (session.teacherId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not your session' });
    }

    const records = await Attendance.find({ sessionId: req.params.id })
      .populate('studentId', 'name email rollNumber')
      .sort({ timestamp: -1 });

    res.json({
      sessionId: session._id,
      className: session.className,
      active: session.active,
      count: records.length,
      records: records.map(r => ({
        student: r.studentId,
        timestamp: r.timestamp,
        distanceMeters: r.distanceMeters
      }))
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/sessions/:id/export-csv — Download attendance data in CSV file format
router.get('/:id/export-csv', authenticate, requireRole('teacher'), async (req, res, next) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    if (session.teacherId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not your session' });
    }

    const User = require('../models/User');

    // 1. Fetch all attendance records for this session
    const records = await Attendance.find({ sessionId: req.params.id })
      .populate('studentId', 'name email rollNumber')
      .sort({ timestamp: 1 });

    const attendedEmailMap = new Map();
    records.forEach(r => {
      if (r.studentId && r.studentId.email) {
        attendedEmailMap.set(r.studentId.email.toLowerCase(), r);
      }
    });

    // 2. Fetch course enrolled student emails if session is tied to a Course
    let enrolledEmails = [];
    if (session.courseId) {
      const course = await Course.findById(session.courseId);
      if (course && Array.isArray(course.enrolledEmails)) {
        enrolledEmails = course.enrolledEmails.map(e => e.toLowerCase());
      }
    }

    const formatISTDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : '-';
    const formatISTTime = (d) => d ? `${new Date(d).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true })} IST` : '-';

    const filename = `Attendance_${session.className.replace(/[^a-zA-Z0-9]/g, '_')}_${formatISTDate(session.startTime).replace(/\//g, '-')}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    let csvContent = `"Course Code","Session Name","Date (IST)","Roll Number","Student Name","Student Email","Status","Timestamp (IST)","Distance (m)"\n`;

    const courseCode = session.className.split('—')[0]?.trim() || 'Class';

    // Output attended records first
    for (let r of records) {
      const s = r.studentId || {};
      const roll = s.rollNumber ? `"${s.rollNumber.replace(/"/g, '""')}"` : '"-"';
      const name = s.name ? `"${s.name.replace(/"/g, '""')}"` : '"Unknown"';
      const email = s.email ? `"${s.email.replace(/"/g, '""')}"` : '"-"';
      const time = `"${formatISTTime(r.timestamp)}"`;
      const dist = r.distanceMeters != null ? `"${r.distanceMeters}m"` : '"-"';
      csvContent += `"${courseCode}","${session.className.replace(/"/g, '""')}","${formatISTDate(session.startTime)}",${roll},${name},${email},"PRESENT",${time},${dist}\n`;
    }

    // Output enrolled students who were ABSENT
    for (let emailStr of enrolledEmails) {
      if (!attendedEmailMap.has(emailStr)) {
        const studentUser = await User.findOne({ email: emailStr });
        const roll = studentUser?.rollNumber ? `"${studentUser.rollNumber.replace(/"/g, '""')}"` : '"-"';
        const name = studentUser?.name ? `"${studentUser.name.replace(/"/g, '""')}"` : '"Enrolled Student"';
        csvContent += `"${courseCode}","${session.className.replace(/"/g, '""')}","${formatISTDate(session.startTime)}",${roll},${name},"${emailStr}","ABSENT","-","-"\n`;
      }
    }

    res.status(200).send(csvContent);
  } catch (err) {
    next(err);
  }
});

// POST /api/sessions/:id/end — Teacher ends a session
router.post('/:id/end', authenticate, requireRole('teacher'), async (req, res, next) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    if (session.teacherId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not your session' });
    }

    session.active = false;
    session.endTime = new Date();
    await session.save();

    res.json({ message: 'Session ended', endTime: session.endTime });
  } catch (err) {
    next(err);
  }
});

// GET /api/sessions — Teacher's session history
router.get('/', authenticate, requireRole('teacher'), async (req, res, next) => {
  try {
    const sessions = await Session.find({ teacherId: req.user._id })
      .select('-secret')
      .sort({ startTime: -1 })
      .limit(20);

    res.json(sessions);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
