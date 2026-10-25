const express = require('express');
const {
  scanAttendance,
  getMyAttendance,
  getStudentAnalytics
} = require('../controllers/attendanceController');
const { authenticate, requireRole } = require('../middlewares/auth');

const router = express.Router();

router.post('/scan', authenticate, requireRole('student'), scanAttendance);
router.get('/my', authenticate, requireRole('student'), getMyAttendance);
router.get('/analytics', authenticate, requireRole('student'), getStudentAnalytics);

module.exports = router;
