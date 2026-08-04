const mongoose = require('mongoose');
const crypto = require('crypto');

const sessionSchema = new mongoose.Schema({
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  courseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course'
  },
  className: {
    type: String,
    required: true,
    trim: true
  },
  location: {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true }
  },
  radiusMeters: {
    type: Number,
    default: 50,
    min: 10,
    max: 500
  },
  // Per-session random secret — never leaves the server.
  // Used for HMAC token generation; rotating this invalidates all tokens for this session.
  secret: {
    type: String,
    required: true
  },
  startTime: {
    type: Date,
    default: Date.now
  },
  endTime: Date,
  active: {
    type: Boolean,
    default: true
  }
});

// Auto-generate secret before saving if not provided
sessionSchema.pre('save', function (next) {
  if (!this.secret) {
    this.secret = crypto.randomBytes(32).toString('hex');
  }
  next();
});

module.exports = mongoose.model('Session', sessionSchema);
