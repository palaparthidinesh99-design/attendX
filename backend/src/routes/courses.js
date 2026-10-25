const express = require('express');
const {
  createCourse,
  getCourses,
  getCourseStudents,
  enrollStudents,
  joinCourse,
  exportCourseCSV,
  exportSessionCSV
} = require('../controllers/courseController');
const { authenticate, requireRole } = require('../middlewares/auth');

const router = express.Router();

router.post('/', authenticate, requireRole('teacher'), createCourse);
router.get('/', authenticate, getCourses);
router.get('/:id/students', authenticate, requireRole('teacher'), getCourseStudents);
router.post('/:id/enroll', authenticate, requireRole('teacher'), enrollStudents);
router.post('/join', authenticate, requireRole('student'), joinCourse);
router.get('/:id/export-csv', authenticate, requireRole('teacher'), exportCourseCSV);
router.get('/sessions/:sessionId/export', authenticate, requireRole('teacher'), exportSessionCSV);

module.exports = router;
