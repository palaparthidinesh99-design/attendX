const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  sessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Session',
    required: true,
    index: true
  },
  courseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    index: true
  },
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  audioTokenMatched: { type: Boolean },
  audioTokenWindow: { type: Number },
  distanceMeters: { type: Number },

  status: {
    type: String,
    enum: ['PRESENT', 'LATE', 'REVIEW', 'ABSENT', 'EXCUSED'],
    required: true,
    index: true
  },
  reviewReasons: [{
    type: String,
    enum: ['DEVICE_FANOUT', 'GPS_MISMATCH', 'AUDIO_UNMATCHED']
  }],
  generatedBy: {
    type: String,
    enum: ['SCAN', 'ABSENTEE_JOB'],
    required: true
  },

  deviceFingerprint: { type: String, index: true },
  ipAddress: { type: String },

  dateString: { type: String, required: true, index: true },
  timeString: { type: String }
}, { timestamps: true });

// Compound Unique Indexes & Performance Query Indexes
attendanceSchema.index({ sessionId: 1, studentId: 1 }, { unique: true });  // Duplicate prevention
attendanceSchema.index({ studentId: 1, courseId: 1, dateString: -1 });     // Calendar heatmap & percentage
attendanceSchema.index({ sessionId: 1 });                                   // Streamed CSV export
attendanceSchema.index({ sessionId: 1, deviceFingerprint: 1 });             // Device fanout anomaly check

module.exports = mongoose.model('Attendance', attendanceSchema);
