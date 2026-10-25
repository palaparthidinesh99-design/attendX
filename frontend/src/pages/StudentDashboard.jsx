import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import confetti from 'canvas-confetti';
import { apiFetch, getUser } from '../utils/api';
import Navbar from '../components/Navbar';
import {
  Camera,
  CheckCircle,
  AlertCircle,
  Plus,
  BookOpen,
  Calendar,
  X,
  Compass,
  TrendingUp
} from 'lucide-react';
import '../styles/dashboard.css';

export default function StudentDashboard() {
  const user = getUser();
  const [analytics, setAnalytics] = useState({ subjects: [], sessionsByDate: {} });
  const [loading, setLoading] = useState(true);

  // Scanner States
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState(null); // { type: 'success' | 'error' | 'info', message: '' }
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Join Course Modal
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [joinMsg, setJoinMsg] = useState('');
  const [joinError, setJoinError] = useState('');

  const scannerRef = useRef(null);

  // 1. Fetch Student Analytics & Enrolled Courses
  const loadAnalytics = async () => {
    try {
      const data = await apiFetch('/api/attendance/analytics');
      setAnalytics(data);
    } catch (err) {
      console.error('Error loading analytics:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAnalytics();
  }, []);

  // 2. Start QR Camera Scanner
  const startScanner = async () => {
    setScanning(true);
    setScanStatus({ type: 'info', message: 'Requesting camera & GPS location…' });

    try {
      // Fetch GPS Position
      const position = await new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          return reject(new Error('Geolocation not supported by device'));
        }
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000
        });
      });

      const { latitude, longitude, accuracy } = position.coords;
      setScanStatus({ type: 'info', message: '📍 GPS locked. Point camera at the rotating QR code…' });

      // Initialize Html5Qrcode
      const html5QrCode = new Html5Qrcode('qr-reader-viewport');
      scannerRef.current = html5QrCode;

      await html5QrCode.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        async (decodedText) => {
          if (isSubmitting) return;
          setIsSubmitting(true);
          try {
            await html5QrCode.stop();
          } catch (_) {}
          setScanning(false);

          handleAttendanceSubmit(decodedText, latitude, longitude, accuracy);
        },
        () => {} // scan failure frame callback ignored
      );
    } catch (err) {
      setScanning(false);
      setScanStatus({
        type: 'error',
        message: err.message || 'Failed to access camera or GPS. Please allow permissions in browser.'
      });
    }
  };

  // 3. Stop Scanner
  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
      } catch (_) {}
      scannerRef.current = null;
    }
    setScanning(false);
  };

  // 4. Submit Scanned Attendance
  const handleAttendanceSubmit = async (qrPayload, lat, lng, accuracy) => {
    setScanStatus({ type: 'info', message: 'Verifying QR code & classroom geofence…' });

    try {
      let parsed;
      try {
        parsed = JSON.parse(qrPayload);
      } catch (_) {
        throw new Error('Invalid QR code format. Please scan the current lecture code.');
      }

      const { sessionId, token } = parsed;
      if (!sessionId || !token) {
        throw new Error('Incomplete QR payload');
      }

      const res = await apiFetch('/api/attendance/scan', {
        method: 'POST',
        body: JSON.stringify({
          sessionId,
          token,
          lat,
          lng,
          accuracyMeters: accuracy || 15
        })
      });

      // Trigger Confetti!
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });

      setScanStatus({
        type: 'success',
        message: `✓ Attendance marked successfully! (${res.record.distanceMeters != null ? res.record.distanceMeters + 'm from instructor' : 'Verified'})`
      });

      loadAnalytics();
    } catch (err) {
      setScanStatus({
        type: 'error',
        message: err.message || 'Verification failed'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // 5. Join Course Handler
  const handleJoinCourse = async (e) => {
    e.preventDefault();
    setJoinError('');
    setJoinMsg('');

    try {
      const res = await apiFetch('/api/courses/join', {
        method: 'POST',
        body: JSON.stringify({ joinCode: joinCodeInput.trim() })
      });

      setJoinMsg(res.message);
      setJoinCodeInput('');
      loadAnalytics();
      setTimeout(() => setShowJoinModal(false), 1500);
    } catch (err) {
      setJoinError(err.message || 'Failed to join course');
    }
  };

  // Aggregate Stats
  const totalAttended = analytics.subjects.reduce((sum, s) => sum + s.attendedSessions, 0);
  const totalConducted = analytics.subjects.reduce((sum, s) => sum + s.totalEndedSessions, 0);
  const overallPct = totalConducted > 0 ? Math.round((totalAttended / totalConducted) * 100) : 100;

  return (
    <div className="dashboard-layout">
      <Navbar />

      <main className="dashboard-content">
        <div className="container">
          <div className="dashboard-header flex items-center justify-between">
            <div>
              <h1 className="dashboard-title">Student Dashboard</h1>
              <p className="dashboard-subtitle">Scan attendance QR codes and track subject eligibility</p>
            </div>
            <button onClick={() => setShowJoinModal(true)} className="btn btn-outline">
              <Plus size={16} />
              <span>Join Course</span>
            </button>
          </div>

          {/* ── Stats Grid ── */}
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-icon stat-icon-teal">
                <TrendingUp size={22} />
              </div>
              <div className="stat-data">
                <span className="stat-value">{overallPct}%</span>
                <span className="stat-label">Overall Attendance</span>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon stat-icon-indigo">
                <CheckCircle size={22} />
              </div>
              <div className="stat-data">
                <span className="stat-value">{totalAttended} / {totalConducted}</span>
                <span className="stat-label">Attended Lectures</span>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon stat-icon-green">
                <BookOpen size={22} />
              </div>
              <div className="stat-data">
                <span className="stat-value">{analytics.subjects.length}</span>
                <span className="stat-label">Enrolled Courses</span>
              </div>
            </div>
          </div>

          {/* ── QR Scanner Card ── */}
          <div className="card scanner-card" style={{ marginBottom: '2.5rem' }}>
            <h3 className="card-title">Check-In Scanner</h3>
            <p className="card-subtitle">Scan the rotating 15s lecture QR code while inside classroom bounds</p>

            {scanStatus && (
              <div className={`alert alert-${scanStatus.type}`} style={{ marginTop: '1rem', textAlign: 'left' }}>
                {scanStatus.type === 'success' && <CheckCircle size={18} />}
                {scanStatus.type === 'error' && <AlertCircle size={18} />}
                {scanStatus.type === 'info' && <Compass size={18} />}
                <span>{scanStatus.message}</span>
              </div>
            )}

            <div
              id="qr-reader-viewport"
              className="scanner-viewport"
              style={{ display: scanning ? 'block' : 'none' }}
            ></div>

            <div style={{ marginTop: '1.25rem' }}>
              {!scanning ? (
                <button onClick={startScanner} className="btn btn-primary btn-full">
                  <Camera size={18} />
                  <span>Scan Attendance QR</span>
                </button>
              ) : (
                <button onClick={stopScanner} className="btn btn-outline btn-full">
                  <X size={18} />
                  <span>Cancel Scanner</span>
                </button>
              )}
            </div>
          </div>

          {/* ── Enrolled Courses & Percentage Bars ── */}
          <div style={{ marginBottom: '2.5rem' }}>
            <div className="flex items-center justify-between" style={{ marginBottom: '1rem' }}>
              <div>
                <h3 className="card-title">Enrolled Courses</h3>
                <p className="card-subtitle">Your subject-wise attendance performance</p>
              </div>
            </div>

            {analytics.subjects.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: '2.5rem 1rem' }}>
                <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
                  You are not enrolled in any courses yet.
                </p>
                <button onClick={() => setShowJoinModal(true)} className="btn btn-outline">
                  <Plus size={16} />
                  <span>Enter Course Code</span>
                </button>
              </div>
            ) : (
              <div className="courses-grid">
                {analytics.subjects.map((s) => {
                  const isEligible = s.percentage >= (s.minAttendancePercentage || 75);
                  return (
                    <div key={s.courseId} className="course-card">
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="course-code">{s.courseCode}</span>
                          <span className={`badge ${isEligible ? 'badge-success' : 'badge-danger'}`}>
                            {isEligible ? 'Eligible' : 'Shortage'}
                          </span>
                        </div>
                        <h4 className="course-name">{s.courseName}</h4>
                        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                          Instructor: {s.teacherName}
                        </p>
                      </div>

                      <div style={{ marginTop: '1.25rem' }}>
                        <div className="flex items-center justify-between" style={{ fontSize: '0.85rem', marginBottom: '0.4rem' }}>
                          <span style={{ fontWeight: 600 }}>{s.percentage}%</span>
                          <span style={{ color: 'var(--text-secondary)' }}>
                            {s.attendedSessions} of {s.totalEndedSessions} attended
                          </span>
                        </div>
                        <div style={{ height: 8, background: 'var(--surface-subtle)', borderRadius: 999, overflow: 'hidden' }}>
                          <div
                            style={{
                              height: '100%',
                              width: `${s.percentage}%`,
                              background: isEligible ? 'var(--primary-color)' : 'var(--danger-color)',
                              borderRadius: 999,
                              transition: 'width 0.4s ease'
                            }}
                          ></div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Attendance History & Timeline ── */}
          <div>
            <h3 className="card-title" style={{ marginBottom: '0.25rem' }}>Lecture History</h3>
            <p className="card-subtitle" style={{ marginBottom: '1rem' }}>Recent class sessions and verification status</p>

            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Course</th>
                    <th>Lecture</th>
                    <th>Date & Time</th>
                    <th>Distance</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(analytics.sessionsByDate).length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                        No lecture attendance records yet.
                      </td>
                    </tr>
                  ) : (
                    Object.entries(analytics.sessionsByDate).flatMap(([dateStr, sessions]) =>
                      sessions.map((s, idx) => (
                        <tr key={`${dateStr}-${idx}`}>
                          <td style={{ fontWeight: 600 }}>{s.courseCode}</td>
                          <td>{s.className}</td>
                          <td style={{ color: 'var(--text-secondary)' }}>
                            {new Date(s.startTime).toLocaleDateString([], { month: 'short', day: 'numeric' })} at {s.timeString}
                          </td>
                          <td>{s.distanceMeters != null ? `${s.distanceMeters}m` : '—'}</td>
                          <td>
                            {s.status === 'PRESENT' && <span className="badge badge-success">✓ Attended</span>}
                            {s.status === 'ONGOING' && <span className="badge badge-info">▶ Live Class</span>}
                            {s.status === 'ABSENT' && <span className="badge badge-danger">❌ Missed</span>}
                          </td>
                        </tr>
                      ))
                    )
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>

      {/* ── Join Course Modal ── */}
      {showJoinModal && (
        <div className="modal-overlay" onClick={() => setShowJoinModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700 }}>Join Course</h3>
              <button onClick={() => setShowJoinModal(false)} className="btn btn-outline btn-sm" style={{ padding: '0.25rem' }}>
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleJoinCourse}>
              <div className="modal-body">
                {joinError && <div className="alert alert-error">{joinError}</div>}
                {joinMsg && <div className="alert alert-success">{joinMsg}</div>}

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Course Code</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. CS101"
                    className="form-input"
                    value={joinCodeInput}
                    onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                  />
                  <small style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '0.4rem', display: 'block' }}>
                    Ask your teacher for the course code.
                  </small>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" onClick={() => setShowJoinModal(false)} className="btn btn-outline">
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Join
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
