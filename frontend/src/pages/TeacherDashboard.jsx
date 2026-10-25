import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { apiFetch, getApiBase, getToken } from '../utils/api';
import Navbar from '../components/Navbar';
import {
  Play,
  Square,
  Users,
  Plus,
  BookOpen,
  MapPin,
  Download,
  Clock,
  CheckCircle,
  RefreshCw,
  X,
  Table,
  Calendar,
  FileSpreadsheet
} from 'lucide-react';
import '../styles/dashboard.css';

export default function TeacherDashboard() {
  const [courses, setCourses] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [sessionToken, setSessionToken] = useState('');
  const [sessionExpiresIn, setSessionExpiresIn] = useState(15000);
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  
  // Launch Session Form State
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [sessionRadius, setSessionRadius] = useState(50);
  const [coords, setCoords] = useState({ lat: null, lng: null });
  const [locating, setLocating] = useState(false);
  const [launchError, setLaunchError] = useState('');

  // Create Course Modal State
  const [showCreateCourseModal, setShowCreateCourseModal] = useState(false);
  const [newCourseCode, setNewCourseCode] = useState('');
  const [newCourseName, setNewCourseName] = useState('');
  const [createCourseError, setCreateCourseError] = useState('');

  // Course Details / Roster Modal State
  const [activeCourseDetails, setActiveCourseDetails] = useState(null);
  const [enrollEmailsInput, setEnrollEmailsInput] = useState('');
  const [enrollMsg, setEnrollMsg] = useState('');

  // Attendance Register Matrix Modal State (Names on rows, dates on columns, P or A)
  const [matrixModalData, setMatrixModalData] = useState(null);
  const [matrixLoading, setMatrixLoading] = useState(false);

  // Individual Sessions Modal State
  const [sessionsModalData, setSessionsModalData] = useState(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  const qrCanvasRef = useRef(null);
  const tokenPollTimer = useRef(null);
  const attendancePollTimer = useRef(null);

  // 1. Fetch Teacher Courses
  const loadCourses = async () => {
    try {
      const data = await apiFetch('/api/courses');
      setCourses(data);
      if (data.length > 0 && !selectedCourseId) {
        setSelectedCourseId(data[0].id);
      }
    } catch (err) {
      console.error('Error loading courses:', err);
    }
  };

  // 2. Auto-Detect Teacher's Classroom Location
  const handleAutoLocate = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          lat: parseFloat(pos.coords.latitude.toFixed(6)),
          lng: parseFloat(pos.coords.longitude.toFixed(6))
        });
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        alert('Could not detect location: ' + err.message + '. Please ensure location permissions are granted.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // 3. Initial Mount: Load courses and locate teacher
  useEffect(() => {
    loadCourses();
    handleAutoLocate();
  }, []);

  // 4. Start Session Handler
  const handleStartSession = async (e) => {
    e.preventDefault();
    setLaunchError('');

    if (!selectedCourseId) {
      setLaunchError('Please select a course to start a session');
      return;
    }
    if (coords.lat == null || coords.lng == null) {
      setLaunchError('Classroom GPS coordinates are required for spatial geofencing. Click "Detect Location"');
      return;
    }

    try {
      const selectedCourse = courses.find((c) => c.id === selectedCourseId);
      const res = await apiFetch('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({
          courseId: selectedCourseId,
          className: selectedCourse ? `${selectedCourse.courseCode} — ${selectedCourse.courseName}` : 'Lecture Session',
          lat: coords.lat,
          lng: coords.lng,
          radiusMeters: parseInt(sessionRadius, 10)
        })
      });

      setActiveSession({
        id: res.sessionId || res.id,
        courseId: selectedCourseId,
        courseName: selectedCourse ? selectedCourse.courseName : 'Class',
        courseCode: selectedCourse ? selectedCourse.courseCode : '',
        radiusMeters: sessionRadius,
        startsAt: new Date().toISOString()
      });
      setAttendanceRecords([]);
    } catch (err) {
      setLaunchError(err.message || 'Failed to start session');
    }
  };

  // 5. End Session Handler
  const handleEndSession = async () => {
    if (!activeSession) return;
    try {
      await apiFetch(`/api/sessions/${activeSession.id}/end`, { method: 'POST' });
      setActiveSession(null);
      setSessionToken('');
      setAttendanceRecords([]);
      loadCourses();
    } catch (err) {
      alert('Error ending session: ' + err.message);
    }
  };

  // 6. Rotating QR Token Poll & Canvas Draw
  useEffect(() => {
    if (!activeSession) return;

    const pollToken = async () => {
      try {
        const data = await apiFetch(`/api/sessions/${activeSession.id}/token`);
        setSessionToken(data.token);
        setSessionExpiresIn(data.windowExpiresIn || 15000);

        if (qrCanvasRef.current) {
          await QRCode.toCanvas(qrCanvasRef.current, data.qrPayload, {
            width: 260,
            margin: 1,
            color: { dark: '#0f172a', light: '#ffffff' }
          });
        }
      } catch (err) {
        console.error('QR token poll error:', err);
      }
    };

    const pollAttendance = async () => {
      try {
        const data = await apiFetch(`/api/sessions/${activeSession.id}/attendance`);
        setAttendanceRecords(data.records || []);
      } catch (err) {
        console.error('Attendance poll error:', err);
      }
    };

    pollToken();
    pollAttendance();

    tokenPollTimer.current = setInterval(pollToken, 1000);
    attendancePollTimer.current = setInterval(pollAttendance, 3000);

    return () => {
      clearInterval(tokenPollTimer.current);
      clearInterval(attendancePollTimer.current);
    };
  }, [activeSession]);

  // 7. Create Course Handler
  const handleCreateCourse = async (e) => {
    e.preventDefault();
    setCreateCourseError('');
    try {
      await apiFetch('/api/courses', {
        method: 'POST',
        body: JSON.stringify({
          courseCode: newCourseCode,
          courseName: newCourseName
        })
      });
      setShowCreateCourseModal(false);
      setNewCourseCode('');
      setNewCourseName('');
      loadCourses();
    } catch (err) {
      setCreateCourseError(err.message || 'Failed to create course');
    }
  };

  // 8. Open Course Roster Modal
  const openCourseRoster = async (courseId) => {
    try {
      const data = await apiFetch(`/api/courses/${courseId}/students`);
      setActiveCourseDetails(data);
      setEnrollEmailsInput('');
      setEnrollMsg('');
    } catch (err) {
      alert('Error loading course roster: ' + err.message);
    }
  };

  // 9. Open Attendance Register Matrix Modal (View full P/A table)
  const openAttendanceMatrix = async (courseId) => {
    setMatrixLoading(true);
    try {
      const data = await apiFetch(`/api/courses/${courseId}/attendance-matrix`);
      setMatrixModalData(data);
    } catch (err) {
      alert('Error loading attendance matrix: ' + err.message);
    } finally {
      setMatrixLoading(false);
    }
  };

  // 10. Open Course Past Sessions Modal (Download each session separately)
  const openCourseSessions = async (courseId) => {
    setSessionsLoading(true);
    try {
      const data = await apiFetch(`/api/courses/${courseId}/sessions`);
      setSessionsModalData(data);
    } catch (err) {
      alert('Error loading course sessions: ' + err.message);
    } finally {
      setSessionsLoading(false);
    }
  };

  // 11. Enroll Students to Course
  const handleEnrollStudents = async (e) => {
    e.preventDefault();
    if (!enrollEmailsInput.trim() || !activeCourseDetails) return;
    try {
      const res = await apiFetch(`/api/courses/${activeCourseDetails.courseId}/enroll`, {
        method: 'POST',
        body: JSON.stringify({ emails: enrollEmailsInput })
      });
      setEnrollMsg(res.message);
      setEnrollEmailsInput('');
      openCourseRoster(activeCourseDetails.courseId);
      loadCourses();
    } catch (err) {
      alert('Enrollment error: ' + err.message);
    }
  };

  // Progress percentage (0% to 100%)
  const progressPct = ((sessionExpiresIn % 15000) / 15000) * 100;

  return (
    <div className="dashboard-layout">
      <Navbar />

      <main className="dashboard-content">
        <div className="container">
          <div className="dashboard-header flex items-center justify-between">
            <div>
              <h1 className="dashboard-title">Instructor Workspace</h1>
              <p className="dashboard-subtitle">Host rotating QR sessions, view attendance registers, and download session CSVs</p>
            </div>
            <button onClick={() => setShowCreateCourseModal(true)} className="btn btn-primary">
              <Plus size={16} />
              <span>Create Course</span>
            </button>
          </div>

          {/* ── Active Session Monitor ── */}
          {activeSession ? (
            <div className="card active-session-card" style={{ marginBottom: '2.5rem' }}>
              <div className="flex items-center justify-between" style={{ marginBottom: '1.25rem' }}>
                <div className="flex items-center gap-2">
                  <span className="live-indicator"></span>
                  <h3 className="card-title" style={{ margin: 0 }}>
                    Live Session: {activeSession.courseCode} — {activeSession.courseName}
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={`${getApiBase()}/api/sessions/${activeSession.id}/export-csv?token=${getToken()}`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-outline btn-sm"
                    title="Download Current Session CSV with P or A for each enrolled student"
                  >
                    <Download size={14} />
                    <span>Download Session CSV</span>
                  </a>
                  <button onClick={handleEndSession} className="btn btn-danger btn-sm">
                    <Square size={14} />
                    <span>End Session</span>
                  </button>
                </div>
              </div>

              <div className="session-grid">
                {/* QR Canvas Display */}
                <div className="qr-container">
                  <div className="qr-box">
                    <canvas ref={qrCanvasRef} className="qr-canvas"></canvas>
                  </div>

                  <div className="qr-meta">
                    <div className="flex items-center justify-between" style={{ fontSize: '0.82rem', marginBottom: '0.4rem' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>HMAC Rotating Token:</span>
                      <code className="token-badge">{sessionToken || 'GENERATING…'}</code>
                    </div>

                    <div className="progress-bar-track">
                      <div className="progress-bar-fill" style={{ width: `${progressPct}%` }}></div>
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', textAlign: 'center', marginTop: '0.4rem' }}>
                      Rotates every 15 seconds to eliminate QR sharing & proxy attendance
                    </span>
                  </div>
                </div>

                {/* Session Live Metrics */}
                <div className="session-details">
                  <h4 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem' }}>Session Parameters</h4>

                  <div className="details-list">
                    <div className="detail-item">
                      <span className="detail-label">Geofence Radius:</span>
                      <span className="detail-value">{activeSession.radiusMeters} meters</span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">Instructor Coordinates:</span>
                      <span className="detail-value font-mono">{coords.lat}, {coords.lng}</span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">Current Check-Ins:</span>
                      <span className="detail-value font-bold" style={{ color: 'var(--primary-color)' }}>
                        {attendanceRecords.length} Students Present
                      </span>
                    </div>
                  </div>

                  <div className="alert alert-info" style={{ marginTop: '1.25rem', fontSize: '0.82rem' }}>
                    Students must scan the rotating QR code while physically within {activeSession.radiusMeters}m of your detected GPS location after verifying their biometric fingerprint passkey.
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* ── Start New Attendance Session Card ── */
            <div className="card" style={{ marginBottom: '2.5rem' }}>
              <h3 className="card-title">Launch Attendance Session</h3>
              <p className="card-subtitle">Set up classroom geofence and project rotating HMAC QR code</p>

              {launchError && <div className="alert alert-error" style={{ marginBottom: '1.25rem' }}>{launchError}</div>}

              <form onSubmit={handleStartSession}>
                <div className="grid-3" style={{ marginBottom: '1.25rem' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Select Course</label>
                    <select
                      className="form-select"
                      value={selectedCourseId}
                      onChange={(e) => setSelectedCourseId(e.target.value)}
                      required
                    >
                      {courses.length === 0 ? (
                        <option value="">No courses created yet</option>
                      ) : (
                        courses.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.courseCode} — {c.courseName}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Geofence Radius</label>
                    <select
                      className="form-select"
                      value={sessionRadius}
                      onChange={(e) => setSessionRadius(e.target.value)}
                    >
                      <option value={20}>20 meters (Small Lab)</option>
                      <option value={50}>50 meters (Standard Classroom)</option>
                      <option value={100}>100 meters (Lecture Hall)</option>
                      <option value={200}>200 meters (Auditorium)</option>
                    </select>
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Classroom Location</label>
                    <button
                      type="button"
                      onClick={handleAutoLocate}
                      className="btn btn-outline btn-full"
                      disabled={locating}
                    >
                      <MapPin size={16} />
                      <span>{locating ? 'Detecting…' : coords.lat ? `✓ ${coords.lat}, ${coords.lng}` : 'Detect Location'}</span>
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={courses.length === 0}
                >
                  <Play size={16} />
                  <span>Start Attendance Session</span>
                </button>
              </form>
            </div>
          )}

          {/* ── Live Attendance Feed (if session active) ── */}
          {activeSession && (
            <div style={{ marginBottom: '2.5rem' }}>
              <div className="flex items-center justify-between" style={{ marginBottom: '1rem' }}>
                <h3 className="card-title">Live Check-In Feed ({attendanceRecords.length})</h3>
                <div className="flex items-center gap-2">
                  <span className="badge badge-primary">Auto-Refreshing</span>
                  <a
                    href={`${getApiBase()}/api/sessions/${activeSession.id}/export-csv?token=${getToken()}`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-outline btn-sm"
                  >
                    <Download size={14} />
                    <span>Download Session CSV</span>
                  </a>
                </div>
              </div>

              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Email</th>
                      <th>Time</th>
                      <th>Distance</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendanceRecords.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                          Waiting for students to scan the rotating QR code…
                        </td>
                      </tr>
                    ) : (
                      attendanceRecords.map((r, i) => (
                        <tr key={i}>
                          <td style={{ fontWeight: 600 }}>{r.student?.name || 'Student'}</td>
                          <td style={{ color: 'var(--text-secondary)' }}>{r.student?.email}</td>
                          <td>{new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                          <td>{r.distanceMeters != null ? `${r.distanceMeters}m` : '0m'}</td>
                          <td><span className="badge badge-success">✓ Present</span></td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── My Courses Section ── */}
          <div>
            <div className="flex items-center justify-between" style={{ marginBottom: '1rem' }}>
              <div>
                <h3 className="card-title">Your Courses</h3>
                <p className="card-subtitle">Manage rosters, view attendance registers (P/A tables), and download session CSVs</p>
              </div>
            </div>

            {courses.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📚</div>
                <h4 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.25rem' }}>No Courses Created Yet</h4>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
                  Create your first course to begin hosting attendance sessions.
                </p>
                <button onClick={() => setShowCreateCourseModal(true)} className="btn btn-primary">
                  <Plus size={16} />
                  <span>Create Course</span>
                </button>
              </div>
            ) : (
              <div className="courses-grid">
                {courses.map((course) => (
                  <div key={course.id} className="course-card">
                    <div>
                      <span className="course-code">{course.courseCode}</span>
                      <h4 className="course-name">{course.courseName}</h4>
                      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                        👥 {course.enrolledCount} Enrolled Students
                      </p>
                    </div>

                    <div className="flex items-center gap-2" style={{ marginTop: '1.25rem', flexWrap: 'wrap' }}>
                      <button
                        onClick={() => openCourseRoster(course.id)}
                        className="btn btn-outline btn-sm"
                        style={{ flex: '1 1 auto' }}
                        title="Manage Student Enrollment Roster"
                      >
                        <Users size={14} />
                        <span>Roster</span>
                      </button>

                      <button
                        onClick={() => openCourseSessions(course.id)}
                        className="btn btn-outline btn-sm"
                        style={{ flex: '1 1 auto' }}
                        title="View Past Sessions & Download Individual Session CSVs"
                      >
                        <Clock size={14} />
                        <span>Sessions</span>
                      </button>

                      <button
                        onClick={() => openAttendanceMatrix(course.id)}
                        className="btn btn-outline btn-sm"
                        style={{ flex: '1 1 auto' }}
                        title="View Full Attendance Table (Names on rows, dates on columns, P or A)"
                      >
                        <Table size={14} />
                        <span>View Sheet</span>
                      </button>

                      <a
                        href={`${getApiBase()}/api/courses/${course.id}/export-csv?token=${getToken()}`}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-primary btn-sm"
                        title="Download Attendance Register CSV (Names on rows, dates on columns, P or A)"
                      >
                        <Download size={14} />
                        <span>CSV</span>
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* ── Create Course Modal ── */}
      {showCreateCourseModal && (
        <div className="modal-overlay" onClick={() => setShowCreateCourseModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700 }}>Create New Course</h3>
              <button onClick={() => setShowCreateCourseModal(false)} className="btn btn-outline btn-sm" style={{ padding: '0.25rem' }}>
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateCourse}>
              <div className="modal-body">
                {createCourseError && <div className="alert alert-error">{createCourseError}</div>}

                <div className="form-group">
                  <label className="form-label">Course Code</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. CS101, EE202"
                    className="form-input"
                    value={newCourseCode}
                    onChange={(e) => setNewCourseCode(e.target.value.toUpperCase())}
                  />
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Course Title</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Data Structures & Algorithms"
                    className="form-input"
                    value={newCourseName}
                    onChange={(e) => setNewCourseName(e.target.value)}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" onClick={() => setShowCreateCourseModal(false)} className="btn btn-outline">
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Course
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Course Roster Modal ── */}
      {activeCourseDetails && (
        <div className="modal-overlay" onClick={() => setActiveCourseDetails(null)}>
          <div className="modal-content" style={{ maxWidth: 580 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 700 }}>
                  {activeCourseDetails.courseCode} — Enrollment Roster
                </h3>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  {activeCourseDetails.courseName} ({activeCourseDetails.enrolledCount} enrolled)
                </p>
              </div>
              <button onClick={() => setActiveCourseDetails(null)} className="btn btn-outline btn-sm" style={{ padding: '0.25rem' }}>
                <X size={16} />
              </button>
            </div>

            <div className="modal-body">
              {enrollMsg && <div className="alert alert-success">{enrollMsg}</div>}

              {/* Quick Add Form */}
              <form onSubmit={handleEnrollStudents} style={{ marginBottom: '1.5rem' }}>
                <label className="form-label">Enroll Students (Enter Email Addresses)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="student1@uni.edu, student2@uni.edu"
                    className="form-input"
                    value={enrollEmailsInput}
                    onChange={(e) => setEnrollEmailsInput(e.target.value)}
                  />
                  <button type="submit" className="btn btn-primary">
                    <Plus size={16} />
                    <span>Add</span>
                  </button>
                </div>
                <small style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.35rem', display: 'block' }}>
                  Separate multiple emails with commas.
                </small>
              </form>

              {/* Roster List */}
              <label className="form-label">Current Enrolled Students</label>
              <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)' }}>
                {activeCourseDetails.enrolledStudents.length === 0 ? (
                  <p style={{ padding: '1rem', color: 'var(--text-muted)', textAlign: 'center', fontSize: '0.85rem' }}>
                    No students enrolled yet.
                  </p>
                ) : (
                  <table className="data-table">
                    <tbody>
                      {activeCourseDetails.enrolledStudents.map((s) => (
                        <tr key={s.id}>
                          <td style={{ fontWeight: 600 }}>{s.name}</td>
                          <td style={{ color: 'var(--text-secondary)' }}>{s.email}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div className="modal-footer">
              <a
                href={`${getApiBase()}/api/courses/${activeCourseDetails.courseId}/export-csv?token=${getToken()}`}
                target="_blank"
                rel="noreferrer"
                className="btn btn-outline"
              >
                <Download size={14} />
                <span>Download Register CSV</span>
              </a>
              <button type="button" onClick={() => setActiveCourseDetails(null)} className="btn btn-primary">
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Course Attendance Register Matrix Modal (View P or A by Date) ── */}
      {matrixModalData && (
        <div className="modal-overlay" onClick={() => setMatrixModalData(null)}>
          <div className="modal-content" style={{ maxWidth: 940, width: '95%' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <FileSpreadsheet size={20} color="var(--primary-color)" />
                  <span>{matrixModalData.course.courseCode} — Attendance Register</span>
                </h3>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  {matrixModalData.course.name} • {matrixModalData.students.length} Students • {matrixModalData.sessions.length} Sessions Conducted
                </p>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`${getApiBase()}/api/courses/${matrixModalData.course.id}/export-csv?token=${getToken()}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-primary btn-sm"
                >
                  <Download size={14} />
                  <span>Download Register CSV</span>
                </a>
                <button onClick={() => setMatrixModalData(null)} className="btn btn-outline btn-sm" style={{ padding: '0.25rem' }}>
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              {matrixModalData.students.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                  No students enrolled in this course yet.
                </div>
              ) : (
                <div className="table-container" style={{ margin: 0 }}>
                  <table className="data-table matrix-table">
                    <thead>
                      <tr>
                        <th>Student Name</th>
                        <th>Email</th>
                        {matrixModalData.sessions.map((sess) => (
                          <th key={sess.id} title={new Date(sess.startsAt).toLocaleString()}>
                            {sess.label}
                          </th>
                        ))}
                        <th>Present</th>
                        <th>Total</th>
                        <th>%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matrixModalData.students.map((student) => {
                        const isEligible = student.percentage >= 75;
                        return (
                          <tr key={student.id}>
                            <td style={{ fontWeight: 600 }}>{student.name}</td>
                            <td style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>{student.email}</td>
                            {matrixModalData.sessions.map((sess) => {
                              const val = student.records[sess.id] || 'A';
                              return (
                                <td key={sess.id}>
                                  <span className={val === 'P' ? 'badge-p' : 'badge-a'}>
                                    {val}
                                  </span>
                                </td>
                              );
                            })}
                            <td><strong>{student.presentCount}</strong></td>
                            <td>{student.totalSessions}</td>
                            <td>
                              <strong style={{ color: isEligible ? '#16a34a' : '#dc2626' }}>
                                {student.percentage}%
                              </strong>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                  <span className="badge-p">P</span> = Present
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                  <span className="badge-a">A</span> = Absent
                </span>
              </div>
              <button type="button" onClick={() => setMatrixModalData(null)} className="btn btn-outline">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Course Sessions History Modal (Download Individual Session CSVs) ── */}
      {sessionsModalData && (
        <div className="modal-overlay" onClick={() => setSessionsModalData(null)}>
          <div className="modal-content" style={{ maxWidth: 650, width: '95%' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Clock size={20} color="var(--primary-color)" />
                  <span>{sessionsModalData.course.course_code || sessionsModalData.course.courseCode} — Sessions History</span>
                </h3>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  Download attendance CSV for each session individually with P or A for each enrolled student
                </p>
              </div>
              <button onClick={() => setSessionsModalData(null)} className="btn btn-outline btn-sm" style={{ padding: '0.25rem' }}>
                <X size={16} />
              </button>
            </div>

            <div className="modal-body">
              {sessionsModalData.sessions.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                  No sessions have been launched for this course yet.
                </div>
              ) : (
                <div className="sessions-list-container">
                  {sessionsModalData.sessions.map((sess) => (
                    <div key={sess.id} className="session-item-card">
                      <div className="session-item-info">
                        <div className="session-item-date">
                          <span>📅 {new Date(sess.startsAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                          <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                            ({new Date(sess.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
                          </span>
                          {sess.isActive ? (
                            <span className="badge badge-active" style={{ fontSize: '0.68rem', padding: '0.1rem 0.4rem' }}>Live Active</span>
                          ) : (
                            <span className="badge" style={{ fontSize: '0.68rem', padding: '0.1rem 0.4rem' }}>Ended</span>
                          )}
                        </div>
                        <div className="session-item-stats">
                          <span>👥 Attendance: <strong>{sess.presentCount}</strong> / {sess.enrolledCount} enrolled students present</span>
                        </div>
                      </div>

                      <a
                        href={`${getApiBase()}/api/sessions/${sess.id}/export-csv?token=${getToken()}`}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-outline btn-sm"
                        title="Download CSV for this session with P or A for each enrolled student"
                      >
                        <Download size={14} />
                        <span>Download CSV</span>
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button type="button" onClick={() => setSessionsModalData(null)} className="btn btn-primary">
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
