const express = require('express');
const crypto = require('crypto');
const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const Session = require('../models/Session');
const Attendance = require('../models/Attendance');
const User = require('../models/User');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// POST /api/courses — Teacher creates a course
router.post('/', authenticate, requireRole('teacher'), async (req, res, next) => {
  try {
    const { courseCode, courseName } = req.body;

    if (!courseCode || !courseName) {
      return res.status(400).json({ error: 'courseCode and courseName are required' });
    }

    const cleanCode = courseCode.trim().toUpperCase();
    const cleanName = courseName.trim();

    const existing = await Course.findOne({ teacherId: req.user._id, courseCode: cleanCode });
    if (existing) {
      return res.status(409).json({ error: `Course with code ${cleanCode} already exists` });
    }

    const joinCode = crypto.randomBytes(3).toString('hex').toUpperCase();

    const course = await Course.create({
      teacherId: req.user._id,
      courseCode: cleanCode,
      courseName: cleanName,
      joinCode
    });

    res.status(201).json(course);
  } catch (err) {
    next(err);
  }
});

// GET /api/courses — List teacher's created courses or student's enrolled courses
router.get('/', authenticate, async (req, res, next) => {
  try {
    if (req.user.role === 'teacher') {
      const courses = await Course.find({ teacherId: req.user._id }).sort({ createdAt: -1 }).lean();
      
      const coursesWithStats = await Promise.all(courses.map(async (c) => {
        const activeEnrolledCount = await Enrollment.countDocuments({ courseId: c._id, status: 'ACTIVE' });
        return { ...c, enrolledCount: activeEnrolledCount };
      }));

      return res.json(coursesWithStats);
    } else {
      // Student: Query Enrollment join collection
      const enrollments = await Enrollment.find({ studentId: req.user._id, status: 'ACTIVE' })
        .populate({
          path: 'courseId',
          populate: { path: 'teacherId', select: 'name email' }
        })
        .sort({ createdAt: -1 });

      const courses = enrollments.map(e => e.courseId).filter(Boolean);
      res.json(courses);
    }
  } catch (err) {
    next(err);
  }
});

// POST /api/courses/:id/enroll — Teacher enrolls student email(s) into course
router.post('/:id/enroll', authenticate, requireRole('teacher'), async (req, res, next) => {
  try {
    const { emails } = req.body;
    if (!emails) return res.status(400).json({ error: 'Student email(s) required' });

    const course = await Course.findOne({ _id: req.params.id, teacherId: req.user._id });
    if (!course) return res.status(404).json({ error: 'Course not found or unauthorized' });

    let emailList = [];
    if (Array.isArray(emails)) {
      emailList = emails.map(e => e.trim().toLowerCase()).filter(Boolean);
    } else if (typeof emails === 'string') {
      emailList = emails.split(/[\n,;]+/).map(e => e.trim().toLowerCase()).filter(Boolean);
    }

    if (emailList.length === 0) {
      return res.status(400).json({ error: 'No valid emails provided' });
    }

    const students = await User.find({ email: { $in: emailList }, role: 'student' });
    let enrolledCount = 0;

    for (let student of students) {
      await Enrollment.updateOne(
        { studentId: student._id, courseId: course._id },
        { $set: { status: 'ACTIVE' } },
        { upsert: true }
      );
      enrolledCount++;
    }

    res.json({ message: `Successfully enrolled ${enrolledCount} student(s)` });
  } catch (err) {
    next(err);
  }
});

// POST /api/courses/join — Student joins course by Join Code
router.post('/join', authenticate, requireRole('student'), async (req, res, next) => {
  try {
    const { joinCode } = req.body;
    if (!joinCode) return res.status(400).json({ error: 'joinCode required' });

    const cleanCode = joinCode.trim().toUpperCase();
    const course = await Course.findOne({ joinCode: cleanCode });
    if (!course) return res.status(404).json({ error: 'Invalid join code' });

    await Enrollment.updateOne(
      { studentId: req.user._id, courseId: course._id },
      { $set: { status: 'ACTIVE' } },
      { upsert: true }
    );

    res.json({ message: `Successfully joined ${course.courseCode} (${course.courseName})`, course });
  } catch (err) {
    next(err);
  }
});

// GET /api/courses/sessions/:sessionId/export — Scale-aware Streaming CSV Export
router.get('/sessions/:sessionId/export', authenticate, requireRole('teacher'), async (req, res, next) => {
  try {
    const session = await Session.findById(req.params.sessionId).populate('courseId');
    if (!session) return res.status(404).json({ error: 'Session not found' });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=attendance_${session.courseId.courseCode}_${session.dateString}.csv`);
    res.write('Roll Number,Student Name,Status,Time (IST),Distance (m),Review Reasons,Generated By\n');

    // Mongoose Cursor streams documents without buffering in RAM
    const cursor = Attendance.find({ sessionId: session._id })
      .populate('studentId', 'name rollNumber email')
      .cursor();

    for await (const row of cursor) {
      const roll = row.studentId?.rollNumber ? `"${row.studentId.rollNumber.replace(/"/g, '""')}"` : '"N/A"';
      const name = row.studentId?.name ? `"${row.studentId.name.replace(/"/g, '""')}"` : '"Student"';
      const time = row.timeString || 'N/A';
      const dist = row.distanceMeters != null ? `${row.distanceMeters}m` : 'N/A';
      const reasons = (row.reviewReasons || []).join('|') || 'NONE';

      res.write(`${roll},${name},${row.status},"${time}","${dist}","${reasons}",${row.generatedBy}\n`);
    }

    res.end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
