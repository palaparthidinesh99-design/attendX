const Session = require('../models/Session');
const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const Attendance = require('../models/Attendance');

/**
 * Asynchronously closes a session and backfills explicit ABSENT records
 * for all enrolled students who did not check in during the active session.
 *
 * @param {string|ObjectId} sessionId - Session ID to close
 * @returns {Promise<object>} Summary of session closure & backfilled absent count
 */
async function closeSessionAndBackfillAbsentees(sessionId) {
  const session = await Session.findByIdAndUpdate(
    sessionId,
    { active: false, closedAt: new Date() },
    { new: true }
  );

  if (!session) {
    throw new Error('Session not found');
  }

  // Increment total sessions held on course
  if (session.courseId) {
    await Course.findByIdAndUpdate(session.courseId, { $inc: { totalSessionsHeld: 1 } });
  }

  // Fetch all active student enrollments for this course
  const activeEnrollments = await Enrollment.find({
    courseId: session.courseId,
    status: 'ACTIVE'
  }).select('studentId');

  // Fetch student IDs who already checked in
  const existingAttendances = await Attendance.find({ sessionId: session._id }).select('studentId');
  const checkedInStudentIds = new Set(existingAttendances.map(a => a.studentId.toString()));

  // Filter non-attendees & create bulk explicit ABSENT documents
  const absentDocs = activeEnrollments
    .filter(e => !checkedInStudentIds.has(e.studentId.toString()))
    .map(e => ({
      sessionId: session._id,
      courseId: session.courseId,
      studentId: e.studentId,
      status: 'ABSENT',
      generatedBy: 'ABSENTEE_JOB',
      reviewReasons: [],
      dateString: session.dateString || new Date().toISOString().split('T')[0],
      timeString: new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: true }) + ' IST'
    }));

  let backfilledCount = 0;
  if (absentDocs.length > 0) {
    try {
      const inserted = await Attendance.insertMany(absentDocs, { ordered: false });
      backfilledCount = inserted.length;
    } catch (bulkErr) {
      // Catch duplicate key errors gracefully if any student checked in at the exact closure millisecond
      if (bulkErr.insertedDocs) {
        backfilledCount = bulkErr.insertedDocs.length;
      }
    }
  }

  return {
    sessionId: session._id,
    courseId: session.courseId,
    active: false,
    closedAt: session.closedAt,
    backfilledAbsentCount: backfilledCount
  };
}

module.exports = { closeSessionAndBackfillAbsentees };
