const express = require('express');
const Course = require('../models/Course');
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

    const course = await Course.create({
      teacherId: req.user._id,
      courseCode: cleanCode,
      courseName: cleanName
    });

    res.status(201).json(course);
  } catch (err) {
    next(err);
  }
});

// GET /api/courses — List courses (Teacher's created courses or Student's enrolled courses)
router.get('/', authenticate, async (req, res, next) => {
  try {
    let courses;
    if (req.user.role === 'teacher') {
      courses = await Course.find({ teacherId: req.user._id })
        .populate('enrolledStudents', 'name email rollNumber')
        .sort({ createdAt: -1 });
    } else {
      // Student: find courses where student is enrolled by ObjectId or email
      courses = await Course.find({
        $or: [
          { enrolledStudents: req.user._id },
          { enrolledEmails: req.user.email.toLowerCase() }
        ]
      }).populate('teacherId', 'name email').sort({ createdAt: -1 });
    }

    res.json(courses);
  } catch (err) {
    next(err);
  }
});

// POST /api/courses/:id/enroll — Add student email(s) to a course
router.post('/:id/enroll', authenticate, requireRole('teacher'), async (req, res, next) => {
  try {
    const { emails } = req.body; // Can be a string "a@b.com, c@d.com" or an array

    if (!emails) {
      return res.status(400).json({ error: 'Student email(s) are required' });
    }

    const course = await Course.findOne({ _id: req.params.id, teacherId: req.user._id });
    if (!course) {
      return res.status(404).json({ error: 'Course not found or unauthorized' });
    }

    let emailList = [];
    if (Array.isArray(emails)) {
      emailList = emails.map(e => e.trim().toLowerCase()).filter(Boolean);
    } else if (typeof emails === 'string') {
      emailList = emails.split(/[\n,;]+/).map(e => e.trim().toLowerCase()).filter(Boolean);
    }

    if (emailList.length === 0) {
      return res.status(400).json({ error: 'No valid emails provided' });
    }

    // Find registered student users matching these emails
    const matchingUsers = await User.find({ email: { $in: emailList }, role: 'student' });
    const matchingUserIds = matchingUsers.map(u => u._id.toString());

    // Merge enrolledEmails and enrolledStudents without duplicates
    const existingEmails = new Set(course.enrolledEmails || []);
    emailList.forEach(e => existingEmails.add(e));
    course.enrolledEmails = Array.from(existingEmails);

    const existingStudentIds = new Set((course.enrolledStudents || []).map(id => id.toString()));
    matchingUserIds.forEach(id => existingStudentIds.add(id));
    course.enrolledStudents = Array.from(existingStudentIds);

    await course.save();

    const updated = await Course.findById(course._id).populate('enrolledStudents', 'name email rollNumber');
    res.json({
      message: `Enrolled ${emailList.length} student email(s) successfully`,
      course: updated
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/courses/:id/students — Get course roster
router.get('/:id/students', authenticate, async (req, res, next) => {
  try {
    const course = await Course.findById(req.params.id).populate('enrolledStudents', 'name email rollNumber');
    if (!course) return res.status(404).json({ error: 'Course not found' });

    res.json({
      courseCode: course.courseCode,
      courseName: course.courseName,
      enrolledCount: course.enrolledEmails.length,
      registeredCount: course.enrolledStudents.length,
      enrolledEmails: course.enrolledEmails,
      students: course.enrolledStudents
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/courses/:id/export-csv — Download course attendance CSV anytime
router.get('/:id/export-csv', authenticate, requireRole('teacher'), async (req, res, next) => {
  try {
    const course = await Course.findOne({ _id: req.params.id, teacherId: req.user._id });
    if (!course) return res.status(404).json({ error: 'Course not found or unauthorized' });

    const Session = require('../models/Session');
    const Attendance = require('../models/Attendance');

    // Find latest session for this course
    const latestSession = await Session.findOne({ courseId: course._id }).sort({ startTime: -1 });

    const formatISTDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : '-';
    const formatISTTime = (d) => d ? `${new Date(d).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true })} IST` : '-';

    const filename = `Attendance_${course.courseCode}_${formatISTDate(new Date()).replace(/\//g, '-')}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    let csvContent = `"Course Code","Course Name","Date (IST)","Roll Number","Student Name","Student Email","Status","Timestamp (IST)","Distance (m)"\n`;

    if (!latestSession) {
      // Export enrolled roster if no sessions held yet
      for (let emailStr of (course.enrolledEmails || [])) {
        const studentUser = await User.findOne({ email: emailStr.toLowerCase() });
        const roll = studentUser?.rollNumber ? `"${studentUser.rollNumber.replace(/"/g, '""')}"` : '"-"';
        const name = studentUser?.name ? `"${studentUser.name.replace(/"/g, '""')}"` : '"Enrolled Student"';
        csvContent += `"${course.courseCode}","${course.courseName.replace(/"/g, '""')}","${formatISTDate(new Date())}",${roll},${name},"${emailStr}","ENROLLED","-","-"\n`;
      }
      return res.status(200).send(csvContent);
    }

    // Export latest session attendance
    const records = await Attendance.find({ sessionId: latestSession._id })
      .populate('studentId', 'name email rollNumber')
      .sort({ timestamp: 1 });

    const attendedEmailMap = new Map();
    records.forEach(r => {
      if (r.studentId && r.studentId.email) {
        attendedEmailMap.set(r.studentId.email.toLowerCase(), r);
      }
    });

    for (let r of records) {
      const s = r.studentId || {};
      const roll = s.rollNumber ? `"${s.rollNumber.replace(/"/g, '""')}"` : '"-"';
      const name = s.name ? `"${s.name.replace(/"/g, '""')}"` : '"Unknown"';
      const email = s.email ? `"${s.email.replace(/"/g, '""')}"` : '"-"';
      const time = `"${formatISTTime(r.timestamp)}"`;
      const dist = r.distanceMeters != null ? `"${r.distanceMeters}m"` : '"-"';
      csvContent += `"${course.courseCode}","${latestSession.className.replace(/"/g, '""')}","${formatISTDate(latestSession.startTime)}",${roll},${name},${email},"PRESENT",${time},${dist}\n`;
    }

    for (let emailStr of (course.enrolledEmails || [])) {
      if (!attendedEmailMap.has(emailStr.toLowerCase())) {
        const studentUser = await User.findOne({ email: emailStr.toLowerCase() });
        const roll = studentUser?.rollNumber ? `"${studentUser.rollNumber.replace(/"/g, '""')}"` : '"-"';
        const name = studentUser?.name ? `"${studentUser.name.replace(/"/g, '""')}"` : '"Enrolled Student"';
        csvContent += `"${course.courseCode}","${latestSession.className.replace(/"/g, '""')}","${formatISTDate(latestSession.startTime)}",${roll},${name},"${emailStr}","ABSENT","-","-"\n`;
      }
    }

    res.status(200).send(csvContent);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
