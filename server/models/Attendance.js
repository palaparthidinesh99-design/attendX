const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  sessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Session',
    required: true
  },
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  // Exact distance at time of scan — useful for audit log / dispute resolution
  distanceMeters: {
    type: Number
  }
});

// THE key constraint — this compound unique index is the entire replay/duplicate defense.
// The DB rejects a second Attendance.create() for the same (session, student) pair
// with error code 11000 (duplicate key). No separate "used tokens" tracking needed.
attendanceSchema.index({ sessionId: 1, studentId: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', attendanceSchema);
