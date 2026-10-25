import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import confetti from 'canvas-confetti';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
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
  TrendingUp,
  Fingerprint,
  ShieldCheck,
  Lock,
  Clock
} from 'lucide-react';
import '../styles/dashboard.css';

export default function StudentDashboard() {
  const user = getUser();
  const [analytics, setAnalytics] = useState({ subjects: [], sessionsByDate: {} });
  const [loading, setLoading] = useState(true);

  // Biometric Passkey State
  const [isPasskeyRegistered, setIsPasskeyRegistered] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [passkeyFeedback, setPasskeyFeedback] = useState(null); // { type: 'success' | 'error', text: '' }

  // 30s Biometric Verification Timer State
  const [isBiometricVerified, setIsBiometricVerified] = useState(false);
  const [biometricSecsLeft, setBiometricSecsLeft] = useState(0);
  const biometricTimerRef = useRef(null);

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

  // 1. Fetch Student Analytics
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

  // 2. Check Hardware Biometric Passkey Status
  const checkPasskeyStatus = async () => {
    try {
      const res = await apiFetch('/api/auth/webauthn-status');
      setIsPasskeyRegistered(!!res.isRegistered);
    } catch (err) {
      console.error('Passkey status check error:', err);
    }
  };

  useEffect(() => {
    loadAnalytics();
    checkPasskeyStatus();
  }, []);

  // 3. Register Hardware Biometric Passkey (Touch ID / Fingerprint / Windows Hello)
  const handleRegisterPasskey = async () => {
    if (!window.PublicKeyCredential) {
      setPasskeyFeedback({
        type: 'error',
        text: 'WebAuthn hardware biometrics is not supported on this browser. Please use Chrome, Safari, or Edge.'
      });
      return;
    }

    setPasskeyLoading(true);
    setPasskeyFeedback(null);

    try {
      // 1. Fetch registration options from server
      const options = await apiFetch('/api/auth/webauthn/register-options', { method: 'POST' });

      // 2. Trigger native OS biometric prompt (Touch ID / Android Fingerprint / Windows Hello)
      let attResp;
      try {
        attResp = await startRegistration({ optionsJSON: options });
      } catch (err) {
        if (err.name === 'NotAllowedError') {
          throw new Error('Biometric prompt was canceled or timed out.');
        }
        throw new Error(err.message || 'Hardware biometric prompt failed');
      }

      // 3. Verify hardware attestation on server
      const verifyRes = await apiFetch('/api/auth/webauthn/register-verify', {
        method: 'POST',
        body: JSON.stringify(attResp)
      });

      if (verifyRes.verified) {
        setIsPasskeyRegistered(true);
        setPasskeyFeedback({
          type: 'success',
          text: '✓ Hardware Touch ID / Fingerprint Passkey enrolled successfully!'
        });
        confetti({ particleCount: 70, spread: 60, origin: { y: 0.5 } });
      } else {
        throw new Error(verifyRes.error || 'Biometric verification failed');
      }
    } catch (err) {
      setPasskeyFeedback({
        type: 'error',
        text: err.message || 'Failed to enroll Passkey'
      });
    } finally {
      setPasskeyLoading(false);
    }
  };

  // 4. Biometric Timer Management
  const stopBiometricTimer = () => {
    if (biometricTimerRef.current) {
      clearInterval(biometricTimerRef.current);
      biometricTimerRef.current = null;
    }
    setIsBiometricVerified(false);
    setBiometricSecsLeft(0);
  };

  const start30SecBiometricWindow = (onExpired) => {
    stopBiometricTimer();
    setIsBiometricVerified(true);
    setBiometricSecsLeft(30);

    const expiresAt = Date.now() + 30000;

    biometricTimerRef.current = setInterval(() => {
      const remainingMs = expiresAt - Date.now();
      const secs = Math.max(0, Math.ceil(remainingMs / 1000));
      setBiometricSecsLeft(secs);

      if (remainingMs <= 0) {
        stopBiometricTimer();
        if (onExpired) onExpired();
      }
    }, 200);
  };

  // 5. Start 3-Layer Attendance Scan Workflow
  const startAttendanceWorkflow = async () => {
    // Check Layer 1 Passkey Registration
    if (!isPasskeyRegistered) {
      setScanStatus({
        type: 'error',
        message: '☝️ Passkey Required: Please register your hardware Touch ID / Fingerprint first above before scanning.'
      });
      return;
    }

    setScanStatus({
      type: 'info',
      message: '☝️ Layer 1: Please scan your Fingerprint / Touch ID on your device to unlock scanner…'
    });

    try {
      // Step A: WebAuthn Hardware Authentication Challenge
      const authOptions = await apiFetch('/api/auth/webauthn/authenticate-options', { method: 'POST' });

      let asseResp;
      try {
        asseResp = await startAuthentication({ optionsJSON: authOptions });
      } catch (err) {
        if (err.name === 'NotAllowedError') {
          setScanStatus({
            type: 'error',
            message: 'Biometric scan canceled. You must verify Touch ID / Fingerprint to mark attendance.'
          });
          return;
        }
        throw new Error(`Biometric hardware error: ${err.message}`);
      }

      // Step B: Verify Hardware Signature
      const verifyRes = await apiFetch('/api/auth/webauthn/authenticate-verify', {
        method: 'POST',
        body: JSON.stringify(asseResp)
      });

      if (!verifyRes.verified) {
        throw new Error('Biometric signature could not be verified by server.');
      }

      // Layer 1 Verified! Start 30s window and launch Camera + GPS
      setScanStatus({
        type: 'info',
        message: '✓ Layer 1 Verified! Locking GPS coordinates & activating QR camera…'
      });

      start30SecBiometricWindow(() => {
        stopScanner();
        setScanStatus({
          type: 'error',
          message: '⏱️ 30-second biometric window expired. Please tap Verify Biometrics to scan again.'
        });
      });

      await launchCameraAndGPS();
    } catch (err) {
      setScanStatus({
        type: 'error',
        message: err.message || 'Biometric authentication failed'
      });
    }
  };

  // 6. Launch Camera and GPS
  const launchCameraAndGPS = async () => {
    setScanning(true);

    try {
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
      setScanStatus({
        type: 'info',
        message: '📍 GPS locked. Point camera at the rotating 15s QR code…'
      });

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
          stopBiometricTimer();

          handleAttendanceSubmit(decodedText, latitude, longitude, accuracy);
        },
        () => {}
      );
    } catch (err) {
      setScanning(false);
      stopBiometricTimer();
      setScanStatus({
        type: 'error',
        message: err.message || 'Failed to access camera or GPS. Please allow permissions in browser.'
      });
    }
  };

  // 7. Stop Scanner
  const stopScanner = async () => {
    stopBiometricTimer();
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
      } catch (_) {}
      scannerRef.current = null;
    }
    setScanning(false);
  };

  // 8. Submit Scanned Attendance
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

  // 9. Join Course Handler
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

  // Calculate overall metrics
  const totalConducted = analytics.subjects.reduce((sum, s) => sum + s.totalEndedSessions, 0);
  const totalAttended = analytics.subjects.reduce((sum, s) => sum + s.attendedSessions, 0);
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

          {/* ── Layer 1 Biometric Passkey Enrollment Banner ── */}
          <div className={`passkey-banner ${!isPasskeyRegistered ? 'passkey-banner-unregistered' : ''}`}>
            <div className="passkey-banner-content">
              <div className={`passkey-icon-box ${!isPasskeyRegistered ? 'unregistered' : ''}`}>
                <Fingerprint size={24} />
              </div>
              <div>
                <div className="passkey-title">
                  <span>Layer 1 Defense: Hardware Biometric Passkey</span>
                  {isPasskeyRegistered ? (
                    <span className="badge-green">✓ Active & Enrolled</span>
                  ) : (
                    <span className="badge-amber">Action Required</span>
                  )}
                </div>
                <p className="passkey-desc">
                  {isPasskeyRegistered
                    ? 'Your Touch ID / Fingerprint passkey is bound to this device. Each attendance scan will require biometric confirmation.'
                    : 'Enroll your device’s Touch ID, Windows Hello, or Android Fingerprint to bind your student identity and eliminate proxy logins.'}
                </p>
                {passkeyFeedback && (
                  <p style={{ marginTop: '0.4rem', fontSize: '0.8rem', fontWeight: 600, color: passkeyFeedback.type === 'success' ? '#16a34a' : '#dc2626' }}>
                    {passkeyFeedback.text}
                  </p>
                )}
              </div>
            </div>

            {!isPasskeyRegistered && (
              <button
                type="button"
                onClick={handleRegisterPasskey}
                disabled={passkeyLoading}
                className="btn btn-primary"
                style={{ flexShrink: 0 }}
              >
                <Fingerprint size={16} />
                <span>{passkeyLoading ? 'Prompting Sensor…' : 'Enroll Fingerprint'}</span>
              </button>
            )}
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

          {/* ── 3-Layer Check-In Scanner Card ── */}
          <div className="card scanner-card" style={{ marginBottom: '2.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
              <ShieldCheck size={20} color="#0d9488" />
              <h3 className="card-title" style={{ margin: 0 }}>3-Layer Attendance Scanner</h3>
            </div>
            <p className="card-subtitle">
              Biometric Passkey ➔ 15s Rotating QR ➔ Classroom Geofence
            </p>

            {/* 30-Second Biometric Timer Countdown Bar */}
            {isBiometricVerified && (
              <div className="biometric-timer-bar-container">
                <div className="biometric-timer-header">
                  <span>☝️ Biometric Verified (30s Window)</span>
                  <span>{biometricSecsLeft}s left</span>
                </div>
                <div className="biometric-progress-track">
                  <div
                    className="biometric-progress-fill"
                    style={{ width: `${(biometricSecsLeft / 30) * 100}%` }}
                  ></div>
                </div>
              </div>
            )}

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
                <button
                  onClick={startAttendanceWorkflow}
                  className="btn btn-primary btn-full"
                  style={{ gap: '0.5rem', padding: '0.85rem' }}
                >
                  <Fingerprint size={18} />
                  <span>Verify Biometrics & Scan QR</span>
                </button>
              ) : (
                <button onClick={stopScanner} className="btn btn-outline btn-full">
                  <X size={18} />
                  <span>Cancel Scanner</span>
                </button>
              )}
            </div>
          </div>

          {/* ── Course-by-Course Attendance Table ── */}
          <div className="card" style={{ marginBottom: '2.5rem' }}>
            <h3 className="card-title">Enrolled Courses Eligibility</h3>
            <p className="card-subtitle">Attendance breakdown per enrolled course subject</p>

            {loading ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                Loading course analytics…
              </div>
            ) : analytics.subjects.length === 0 ? (
              <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                You are not enrolled in any courses yet. Click "Join Course" with a teacher's course code.
              </div>
            ) : (
              <div className="table-container" style={{ marginTop: '1.25rem' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Course Code</th>
                      <th>Course Name</th>
                      <th>Attended</th>
                      <th>Total Sessions</th>
                      <th>Percentage</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.subjects.map((sub) => {
                      const isEligible = sub.percentage >= 75;
                      return (
                        <tr key={sub.courseId}>
                          <td style={{ fontWeight: 700, fontFamily: 'monospace' }}>{sub.courseCode}</td>
                          <td>{sub.courseName}</td>
                          <td>{sub.attendedSessions}</td>
                          <td>{sub.totalEndedSessions}</td>
                          <td>
                            <span style={{ fontWeight: 700, color: isEligible ? '#16a34a' : '#dc2626' }}>
                              {sub.percentage}%
                            </span>
                          </td>
                          <td>
                            <span className={`badge ${isEligible ? 'badge-active' : 'badge-inactive'}`}>
                              {isEligible ? 'Eligible (≥75%)' : 'Defaulter (<75%)'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Attendance Calendar Grid ── */}
          <div className="card">
            <div className="flex items-center gap-2" style={{ marginBottom: '0.25rem' }}>
              <Calendar size={18} color="var(--primary-color)" />
              <h3 className="card-title" style={{ margin: 0 }}>Attendance Calendar</h3>
            </div>
            <p className="card-subtitle">Daily attendance status across your enrolled subjects</p>

            <div style={{ marginTop: '1.5rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1rem' }}>
              {Object.keys(analytics.sessionsByDate || {}).length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.88rem', padding: '1rem 0' }}>
                  No historical sessions recorded yet.
                </div>
              ) : (
                Object.entries(analytics.sessionsByDate)
                  .sort(([a], [b]) => b.localeCompare(a))
                  .slice(0, 12)
                  .map(([date, items]) => (
                    <div
                      key={date}
                      style={{
                        padding: '1rem',
                        background: 'var(--surface-subtle)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 'var(--radius-md)'
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                        📅 {new Date(date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        {items.map((item, idx) => (
                          <div
                            key={idx}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              fontSize: '0.8rem',
                              padding: '0.25rem 0'
                            }}
                          >
                            <span style={{ fontWeight: 600 }}>{item.courseCode}</span>
                            <span
                              style={{
                                fontWeight: 700,
                                color: item.status === 'present' ? '#16a34a' : '#dc2626'
                              }}
                            >
                              {item.status === 'present' ? '✓ Present' : '✗ Absent'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      </main>

      {/* ── Join Course Modal ── */}
      {showJoinModal && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="modal-header">
              <h3 className="modal-title">Join a Course</h3>
              <button onClick={() => setShowJoinModal(false)} className="btn-icon">
                <X size={18} />
              </button>
            </div>

            {joinError && <div className="alert alert-error">{joinError}</div>}
            {joinMsg && <div className="alert alert-success">{joinMsg}</div>}

            <form onSubmit={handleJoinCourse}>
              <div className="form-group">
                <label className="form-label">Course Code</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. CS101"
                  className="form-input"
                  style={{ textTransform: 'uppercase' }}
                  value={joinCodeInput}
                  onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                />
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.25rem', display: 'block' }}>
                  Ask your teacher for the course code (e.g. CS101, MATH201)
                </span>
              </div>

              <div className="modal-footer">
                <button type="button" onClick={() => setShowJoinModal(false)} className="btn btn-outline">
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Join Course
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
