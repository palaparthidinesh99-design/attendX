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
  X
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

  // 2. Fetch Active Session (if any)
  const checkActiveSession = async () => {
    try {
      const sessions = await apiFetch('/api/sessions');
      const active = sessions.find((s) => s.active);
      if (active) {
        setActiveSession(active);
      }
    } catch (err) {
      console.error('Error checking active session:', err);
    }
  };

  useEffect(() => {
    loadCourses();
    checkActiveSession();
  }, []);

  // 3. Auto-locate Teacher
  const handleAutoLocate = () => {
    if (!navigator.geolocation) {
      return setLaunchError('Geolocation is not supported by your browser.');
    }
    setLocating(true);
    setLaunchError('');
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
        setLaunchError(`Location error: ${err.message}. Please allow location access.`);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // 4. Start New Session
  const handleLaunchSession = async (e) => {
    e.preventDefault();
    setLaunchError('');

    if (!selectedCourseId) {
      return setLaunchError('Please select a course.');
    }
    if (coords.lat == null || coords.lng == null) {
      return setLaunchError('Please click "Detect Location" to set classroom coordinates.');
    }

    const course = courses.find((c) => c.id === selectedCourseId);
    try {
      const data = await apiFetch('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({
          className: course?.courseName || 'Class Lecture',
          courseId: selectedCourseId,
          lat: coords.lat,
          lng: coords.lng,
          radiusMeters: sessionRadius
        })
      });

      setActiveSession({
        id: data.sessionId,
        className: data.className,
        location: data.location,
        radiusMeters: data.radiusMeters
      });
      setAttendanceRecords([]);
    } catch (err) {
      setLaunchError(err.message || 'Failed to start session');
    }
  };

  // 5. End Session
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

  // 9. Enroll Students to Course
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
              <h1 className="dashboard-title">Teacher Dashboard</h1>
              <p className="dashboard-subtitle">Manage courses and launch anti-proxy attendance sessions</p>
            </div>
            <button
              onClick={() => setShowCreateCourseModal(true)}
              className="btn btn-primary"
            >
              <Plus size={16} />
              <span>Create Course</span>
            </button>
          </div>

          {/* ── Active Session Hero (QR Display) ── */}
          {activeSession ? (
            <div className="session-hero">
              <span className="badge badge-success" style={{ marginBottom: '0.75rem' }}>
                ● LIVE ATTENDANCE SESSION
              </span>
              <h2 style={{ fontSize: '1.75rem', fontWeight: 800 }}>{activeSession.className}</h2>
              <p style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
                Radius: {activeSession.radiusMeters}m | Rotating every 15 seconds
              </p>

              <div className="session-qr-canvas">
                <canvas ref={qrCanvasRef}></canvas>
              </div>

              <div className="countdown-bar">
                <div
                  className="countdown-progress"
                  style={{ width: `${progressPct}%` }}
                ></div>
              </div>

              <div className="flex items-center gap-4">
                <span className="badge badge-primary" style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}>
                  👥 {attendanceRecords.length} Students Checked In
                </span>
                <button
                  onClick={handleEndSession}
                  className="btn btn-danger"
                >
                  <Square size={16} />
                  <span>End Session</span>
                </button>
              </div>
            </div>
          ) : (
            /* ── Start New Session Card ── */
            <div className="card" style={{ marginBottom: '2.5rem' }}>
              <div className="flex items-center gap-2" style={{ marginBottom: '1.25rem' }}>
                <div className="stat-icon stat-icon-teal" style={{ width: 36, height: 36, borderRadius: 8 }}>
                  <Play size={18} />
                </div>
                <div>
                  <h3 className="card-title">Launch Attendance Session</h3>
                  <p className="card-subtitle">Generate a 15-second rotating QR code bounded to classroom GPS coordinates</p>
                </div>
              </div>

              {launchError && <div className="alert alert-error">{launchError}</div>}

              <form onSubmit={handleLaunchSession}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Course</label>
                    <select
                      className="form-select"
                      value={selectedCourseId}
                      onChange={(e) => setSelectedCourseId(e.target.value)}
                      required
                    >
                      {courses.length === 0 && <option value="">No courses created yet</option>}
                      {courses.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.courseCode} — {c.courseName}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Geofence Radius</label>
                    <select
                      className="form-select"
                      value={sessionRadius}
                      onChange={(e) => setSessionRadius(parseInt(e.target.value))}
                    >
                      <option value={30}>30 meters (Small Lab)</option>
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
                <span className="badge badge-primary">Auto-Refreshing</span>
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
                <p className="card-subtitle">Manage student enrollment rosters and export attendance CSVs</p>
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

                    <div className="flex items-center gap-2" style={{ marginTop: '1.25rem' }}>
                      <button
                        onClick={() => openCourseRoster(course.id)}
                        className="btn btn-outline btn-sm"
                        style={{ flex: 1 }}
                      >
                        <Users size={14} />
                        <span>Roster</span>
                      </button>

                      <a
                        href={`${getApiBase()}/api/courses/${course.id}/export-csv?token=${getToken()}`}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-outline btn-sm"
                        title="Download Attendance CSV"
                      >
                        <Download size={14} />
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
                  {activeCourseDetails.courseCode} — Roster
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
                <span>Export CSV</span>
              </a>
              <button type="button" onClick={() => setActiveCourseDetails(null)} className="btn btn-primary">
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
