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
  // List of enrolled student user IDs
  enrolledStudents: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  // Enrolled student emails (to allow enrolling before student registers)
  enrolledEmails: [{
    type: String,
    lowercase: true,
    trim: true
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Ensure unique course code per teacher
courseSchema.index({ teacherId: 1, courseCode: 1 }, { unique: true });

module.exports = mongoose.model('Course', courseSchema);
