const express = require('express');
const {
  createSession,
  getSessionToken,
  getSessionAttendance,
  endSession,
  getTeacherSessions,
  exportSessionAttendanceCSV
} = require('../controllers/sessionController');
const { authenticate, requireRole } = require('../middlewares/auth');

const router = express.Router();

router.post('/', authenticate, requireRole('teacher'), createSession);
router.get('/:id/token', getSessionToken);
router.get('/:id/attendance', authenticate, requireRole('teacher'), getSessionAttendance);
router.post('/:id/end', authenticate, requireRole('teacher'), endSession);
router.get('/', authenticate, requireRole('teacher'), getTeacherSessions);
router.get('/:id/export-csv', authenticate, requireRole('teacher'), exportSessionAttendanceCSV);

module.exports = router;
