const mongoose = require('mongoose');

const courseSchema = new mongoose.Schema({
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  courseCode: {
    type: String,
    required: true,
    trim: true,
    uppercase: true
  },
  courseName: {
    type: String,
    required: true,
    trim: true
  },
  joinCode: {
    type: String,
    unique: true,
    sparse: true
  },
  totalSessionsHeld: {
    type: Number,
    default: 0
  },
  // List of enrolled student user IDs (backwards compatible)
  enrolledStudents: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  // Enrolled student emails (backwards compatible)
  enrolledEmails: [{
    type: String,
    lowercase: true,
    trim: true
  }]
}, { timestamps: true });

// Ensure unique course code per teacher
courseSchema.index({ teacherId: 1, courseCode: 1 }, { unique: true });

module.exports = mongoose.model('Course', courseSchema);
