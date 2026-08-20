const mongoose = require('mongoose');
const { Schema } = mongoose;

const enrollmentSchema = new Schema({
  studentId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  courseId: {
    type: Schema.Types.ObjectId,
    ref: 'Course',
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: ['ACTIVE', 'DROPPED'],
    default: 'ACTIVE'
  }
}, { timestamps: true });

// Compound Unique Index for fast "my courses" lookup and duplicate enrollment prevention
enrollmentSchema.index({ studentId: 1, courseId: 1 }, { unique: true });
// Compound Index for active roster queries during absentee backfilling
enrollmentSchema.index({ courseId: 1, status: 1 });

module.exports = mongoose.model('Enrollment', enrollmentSchema);
