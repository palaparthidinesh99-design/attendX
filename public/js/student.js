/* student.js — face-first QR scanner, compact calendar with side panel, real-time analytics sync */

const API = '';

function getToken() { return localStorage.getItem('attendx_token'); }
function getUser()  { return JSON.parse(localStorage.getItem('attendx_user') || 'null'); }

function logout() {
  localStorage.removeItem('attendx_token');
  localStorage.removeItem('attendx_user');
  window.location.href = '/?logout=1';
}

// ── Auth guard ──────────────────────────────────────────────────────────
(function guard() {
  const user = getUser();
  const token = getToken();
  if (!user || !token) return (window.location.href = '/?logout=1');
  if (user.role !== 'student') return (window.location.href = '/teacher.html');
  const navName = document.getElementById('nav-name');
  if (navName) navName.textContent = user.name;
})();

// ── State ───────────────────────────────────────────────────────────────
let html5QrCode = null;
let isProcessing = false;
let userFaceProfile = null;
let isFaceLocked = false;
let activeStream = null;
let livenessLoopId = null;

window.sessionsByDateMap = {};
let currentCalDate = new Date();
let selectedDateStr = new Date().toISOString().split('T')[0];

// ── Status Helper with Retry Button ─────────────────────────────────────
function setScanStatus(msg, type = 'info') {
  const el = document.getElementById('scan-status');
  if (!el) return;
  if (!msg) { el.innerHTML = ''; return; }
  const cls = { success: 'alert-success', error: 'alert-error', info: 'alert-info', warning: 'alert-warning' }[type] || 'alert-info';
  const retryBtn = (type === 'error' || type === 'warning')
    ? `<div style="margin-top:0.4rem;"><button type="button" class="btn btn-ghost btn-sm" onclick="window.resetScanner()">🔄 Try Again</button></div>`
    : '';
  el.innerHTML = `<div class="alert ${cls}">${msg} ${retryBtn}</div>`;
}

// ── Check Saved Facial Profile Status (Hides card once locked) ─────────
async function checkFaceProfileStatus() {
  try {
    const res = await fetch(`${API}/api/auth/face-profile`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    });
    if (!res.ok) {
      if (res.status === 401) logout();
      return;
    }
    const data = await res.json();

    const setupCard = document.getElementById('card-face-setup');
    const reEnrollBtn = document.getElementById('re-enroll-face-btn');

    if (data.hasFaceProfile) {
      userFaceProfile = data.faceDescriptor;
      isFaceLocked = true;
      if (setupCard) setupCard.style.display = 'none';
      // Show re-enroll button in case user needs to reset
      if (reEnrollBtn) reEnrollBtn.style.display = 'block';
    } else {
      isFaceLocked = false;
      userFaceProfile = null;
      if (setupCard) setupCard.style.display = 'block';
      if (reEnrollBtn) reEnrollBtn.style.display = 'none';
    }
  } catch (err) {
    console.error('Face profile status check error:', err);
  }
}

// ── Reset Face Profile (calls DELETE endpoint, re-shows enroll card) ────
async function resetFaceProfile() {
  if (!confirm('This will delete your saved face profile and let you re-enroll. Continue?')) return;
  try {
    const res = await fetch(`${API}/api/auth/face-profile`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${getToken()}` }
    });
    if (res.ok) {
      userFaceProfile = null;
      isFaceLocked = false;
      const setupCard = document.getElementById('card-face-setup');
      const reEnrollBtn = document.getElementById('re-enroll-face-btn');
      if (setupCard) setupCard.style.display = 'block';
      if (reEnrollBtn) reEnrollBtn.style.display = 'none';
      alert('Face profile cleared. Please re-enroll your face.');
    } else {
      alert('Failed to reset face profile.');
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// ── face-api.js Neural Net Face Recognition ───────────────────────────────
// Uses: SSD MobileNet (detection) + 68-pt landmarks + ResNet128 (embedding)
// Models are served locally from /models/ — no external calls at runtime.
let faceApiReady = false;
let faceApiLoadPromise = null;

async function loadFaceApiModels() {
  if (faceApiReady) return;
  // Prevent parallel load calls
  if (faceApiLoadPromise) return faceApiLoadPromise;

  faceApiLoadPromise = (async () => {
    if (typeof faceapi === 'undefined') {
      throw new Error('face-api.js CDN script did not load. Check your internet connection and refresh.');
    }
    const MODEL_URL = '/models';
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
    faceApiReady = true;
    console.log('face-api.js models loaded ✓');
  })();

  return faceApiLoadPromise;
}

// Warm up models as soon as the page is interactive
window.addEventListener('load', () => {
  loadFaceApiModels().catch(err => console.warn('Model preload failed:', err.message));
});

// Extract a 128-D neural face embedding from a video element.
// Returns Float32Array(128) or null if no face detected.
async function extractFaceDescriptor(videoElement) {
  if (!faceApiReady) await loadFaceApiModels();
  const detection = await faceapi
    .detectSingleFace(videoElement, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!detection) return null;
  return Array.from(detection.descriptor); // Float32Array → plain array for JSON
}

// Euclidean distance between two 128-D descriptors.
// face-api.js standard: distance < 0.45 = same person, > 0.6 = different person.
function faceDistance(descA, descB) {
  if (!descA || !descB || descA.length !== descB.length) return 999;
  let sum = 0;
  for (let i = 0; i < descA.length; i++) sum += (descA[i] - descB[i]) ** 2;
  return Math.sqrt(sum);
}

// Match threshold: euclidean distance < 0.55 = same person
// face-api.js recommended: 0.5–0.6 for browser cameras (0.45 is too strict)
const FACE_MATCH_THRESHOLD = 0.55;

// ── Face Profile Enrollment Modal ───────────────────────────────────────
function openFaceEnrollmentModal() {
  document.getElementById('enroll-face-modal').classList.remove('hidden');
  startEnrollCamera();
}

function closeFaceEnrollmentModal() {
  document.getElementById('enroll-face-modal').classList.add('hidden');
  stopCameraStream();
}

async function startEnrollCamera() {
  const video = document.getElementById('enroll-video');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 320, height: 240 } });
    video.srcObject = stream;
    activeStream = stream;
    document.getElementById('enroll-status-text').textContent = 'Look directly into camera…';
  } catch (err) {
    alert('Camera access denied: ' + err.message);
  }
}

async function captureAndSaveFaceProfile() {

  const video = document.getElementById('enroll-video');
  const statusEl = document.getElementById('enroll-modal-status');
  const btn = document.getElementById('capture-face-btn');

  if (!video || !video.videoWidth) {
    if (statusEl) statusEl.innerHTML = '<div class="alert alert-warning mt-1">Waiting for camera stream…</div>';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Detecting face…';

  try {
    if (!faceApiReady) {
      if (statusEl) statusEl.innerHTML = '<div class="alert alert-info mt-1">Loading face recognition models… please wait.</div>';
      await loadFaceApiModels();
    }

    if (statusEl) statusEl.innerHTML = '<div class="alert alert-info mt-1">📸 Analysing your face — look directly at camera…</div>';
    const faceDescriptor = await extractFaceDescriptor(video);

    if (!faceDescriptor) {
      if (statusEl) statusEl.innerHTML = '<div class="alert alert-warning mt-1">⚠️ No face detected. Ensure your face is centred, well-lit, and clearly visible.</div>';
      return;
    }

    const res = await fetch(`${API}/api/auth/face-profile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`
      },
      body: JSON.stringify({ faceDescriptor })
    });

    if (res.ok) {
      userFaceProfile = faceDescriptor;
      isFaceLocked = true;
      if (statusEl) statusEl.innerHTML = '<div class="alert alert-success mt-1">✓ Facial profile registered and locked!</div>';
      setTimeout(() => {
        closeFaceEnrollmentModal();
        checkFaceProfileStatus();
      }, 1200);
    } else {
      const data = await res.json();
      if (statusEl) statusEl.innerHTML = `<div class="alert alert-error mt-1">${data.error || 'Failed to save profile'}</div>`;
    }
  } catch (err) {
    console.error('Face enrollment error:', err);
    if (statusEl) statusEl.innerHTML = `<div class="alert alert-error mt-1">❌ Error: ${err.message || err}. Open DevTools console (F12) for details.</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '📸 Capture & Lock Profile';
  }
}

let faceFacingMode = 'user';
let qrFacingMode = 'environment';

function flipFaceCamera() {
  faceFacingMode = faceFacingMode === 'user' ? 'environment' : 'user';
  stopCameraStream();
  startBiometricScanWorkflow();
}

function flipQRCamera() {
  qrFacingMode = qrFacingMode === 'user' ? 'environment' : 'user';
  openQRScannerCamera();
}

function flipEnrollCamera() {
  faceFacingMode = faceFacingMode === 'user' ? 'environment' : 'user';
  stopCameraStream();
  startEnrollCamera();
}

// ── STEP 1: Face-First Scan Workflow (Verify Face BEFORE QR Code Scan) ──
async function startBiometricScanWorkflow() {
  if (!userFaceProfile) {
    alert('Please register your Facial Profile first before marking attendance.');
    return;
  }

  document.getElementById('scan-prompt').classList.add('hidden');
  document.getElementById('face-verification-view').classList.remove('hidden');
  document.getElementById('qr-reader-container').classList.add('hidden');

  const promptEl = document.getElementById('liveness-prompt');
  const subtextEl = document.getElementById('liveness-subtext');

  promptEl.textContent = '👁️ Step 1: Blink or Nod to verify face';
  promptEl.style.color = '#fbbf24';
  subtextEl.textContent = 'Verifying live biometric match against locked profile…';

  const video = document.getElementById('face-video');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: faceFacingMode, width: 320, height: 240 } });
    video.srcObject = stream;
    activeStream = stream;
  } catch (err) {
    setScanStatus('Camera error: ' + err.message, 'error');
    cleanupVerificationView();
    return;
  }

  let startTime = Date.now();

  async function checkFrame() {
    if (!activeStream) return;

    if (Date.now() - startTime > 20000) {
      subtextEl.textContent = '⚠️ Timed out. Click Try Again.';
      setScanStatus('Biometric verification timed out.', 'error');
      cleanupVerificationView();
      document.getElementById('scan-prompt').classList.remove('hidden');
      isProcessing = false;
      return;
    }

    // Run face detection on the live video
    if (video.videoWidth > 0) {
      try {
        const descriptor = await extractFaceDescriptor(video);

        if (!descriptor) {
          // No face in frame yet — keep polling
          promptEl.textContent = '👤 Centre your face in the camera…';
          promptEl.style.color = '#fbbf24';
        } else {
          // Face detected — compare with enrolled profile
          const dist = faceDistance(userFaceProfile, descriptor);

          if (dist < FACE_MATCH_THRESHOLD) {
            promptEl.textContent = '✓ Face Verified!';
            promptEl.style.color = '#4ade80';
            subtextEl.textContent = `✓ Biometric confirmed (distance: ${dist.toFixed(3)}). Step 2: Scan QR Code.`;
            setTimeout(() => {
              cleanupVerificationView();
              openQRScannerCamera();
            }, 800);
            return;
          } else {
            // Face detected but doesn't match
            verificationAttempts++;
            if (verificationAttempts >= 5) {
              promptEl.textContent = '❌ Face Not Recognised!';
              promptEl.style.color = '#f87171';
              subtextEl.textContent = `Not your registered face (distance: ${dist.toFixed(3)}, need < ${FACE_MATCH_THRESHOLD}). Re-enroll if this persists.`;
              setScanStatus('Biometric rejected — face does not match enrolled profile.', 'error');
              cleanupVerificationView();
              document.getElementById('scan-prompt').classList.remove('hidden');
              isProcessing = false;
              return;
            } else {
              promptEl.textContent = `⚠️ Face mismatch (attempt ${verificationAttempts}/5) — hold still…`;
              promptEl.style.color = '#fbbf24';
            }
          }
        }
      } catch (e) {
        console.warn('face-api detection error:', e);
      }
    }

    // Poll every 600ms
    await new Promise(r => setTimeout(r, 600));
    livenessLoopId = requestAnimationFrame(checkFrame);
  }

  let verificationAttempts = 0;
  livenessLoopId = requestAnimationFrame(checkFrame);
}

// ── STEP 2: Open Camera QR Scanner (Triggered ONLY after Face Match) ───
function openQRScannerCamera() {
  document.getElementById('scan-prompt').classList.add('hidden');
  document.getElementById('face-verification-view').classList.add('hidden');
  document.getElementById('qr-reader-container').classList.remove('hidden');

  setScanStatus('📷 Point camera at teacher\'s rotating QR code', 'info');

  if (html5QrCode) {
    try { html5QrCode.stop(); } catch (_) {}
    html5QrCode = null;
  }

  html5QrCode = new Html5Qrcode('qr-reader');
  const config = { fps: 10, qrbox: { width: 220, height: 220 }, aspectRatio: 1.0 };

  html5QrCode.start(
    { facingMode: qrFacingMode },
    config,
    onQRDecoded,
    () => {}
  ).catch(err => {
    setScanStatus(`Camera error: ${err}. Use manual token entry below.`, 'error');
  });
}

// ── QR Decoded Callback (Enforces Hardware GPS) ────────────────────────
async function onQRDecoded(decodedText) {
  if (isProcessing) return;
  isProcessing = true;

  try { await html5QrCode.stop(); } catch (_) {}

  let payload;
  try {
    payload = JSON.parse(decodedText);
  } catch {
    setScanStatus('Invalid QR format.', 'error');
    isProcessing = false;
    openQRScannerCamera();
    return;
  }

  if (!payload.sessionId || !payload.token) {
    setScanStatus('Invalid QR payload.', 'error');
    isProcessing = false;
    openQRScannerCamera();
    return;
  }

  setScanStatus('📍 Requesting hardware GPS location & submitting check-in…', 'info');

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      await submitAttendance(payload.sessionId, payload.token, pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
    },
    (err) => {
      setScanStatus('Location error: ' + err.message, 'error');
      isProcessing = false;
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

function cleanupVerificationView() {
  stopCameraStream();
  if (livenessLoopId) cancelAnimationFrame(livenessLoopId);
  document.getElementById('face-verification-view')?.classList.add('hidden');
}

function stopCameraStream() {
  if (activeStream) {
    activeStream.getTracks().forEach(t => t.stop());
    activeStream = null;
  }
}

// ── Submit Attendance Payload ───────────────────────────────────────────
async function submitAttendance(sessionId, token, lat, lng, accuracyMeters = null) {
  try {
    const res = await fetch(`${API}/api/attendance/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`
      },
      body: JSON.stringify({ sessionId, token, lat, lng, accuracyMeters })
    });

    const data = await res.json();

    if (res.ok) {
      showSuccessView(data);
      loadAnalytics();
    } else {
      if (res.status === 401) {
        setScanStatus('⏱️ QR code expired or invalid.', 'error');
      } else if (res.status === 403) {
        setScanStatus(`📍 Access Denied: ${data.error}`, 'error');
      } else if (res.status === 409) {
        setScanStatus('✅ Attendance already marked for this session', 'warning');
      } else {
        setScanStatus(data.error || 'Submission failed', 'error');
      }

      isProcessing = false;
    }
  } catch (err) {
    setScanStatus('Network error', 'error');
    isProcessing = false;
  }
}

function showSuccessView(data) {
  setScanStatus('', '');
  document.getElementById('qr-reader').classList.add('hidden');

  const user = getUser();
  document.getElementById('success-detail').textContent =
    `Welcome, ${user?.name || 'Student'}! Face & Attendance verified.`;

  const meta = document.getElementById('success-meta');
  const time = new Date(data.record?.timestamp || Date.now()).toLocaleTimeString();
  const dist = data.record?.distanceMeters != null ? `📍 ${data.record.distanceMeters}m away` : '';

  meta.innerHTML = [
    `<span class="badge badge-green">✓ Present</span>`,
    `<span class="badge badge-blue">🕒 ${time}</span>`,
    dist ? `<span class="badge badge-purple">${dist}</span>` : ''
  ].filter(Boolean).join('');

  document.getElementById('success-view').classList.remove('hidden');
}

function resetScanner() {
  document.getElementById('success-view').classList.add('hidden');
  document.getElementById('scan-prompt').classList.remove('hidden');
  document.getElementById('qr-reader').classList.add('hidden');
  document.getElementById('face-verification-view').classList.add('hidden');
  setScanStatus('', '');
  isProcessing = false;
  if (html5QrCode) {
    try { html5QrCode.stop(); } catch (_) {}
    html5QrCode = null;
  }
  stopCameraStream();
}

async function submitManualToken() {
  const raw = document.getElementById('manual-token').value.trim();
  if (!raw) return;

  let payload;
  try { payload = JSON.parse(raw); } catch {
    return setScanStatus('Please paste valid QR JSON string.', 'error');
  }

  if (!payload.sessionId || !payload.token) {
    return setScanStatus('Invalid QR JSON payload.', 'error');
  }

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      await submitAttendance(payload.sessionId, payload.token, pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
    },
    (err) => {
      setScanStatus('Location error: ' + err.message, 'error');
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

// ── Compact Monthly Attendance Calendar & Side Panel Renderer ────────────
function renderInteractiveCalendar() {
  const container = document.getElementById('calendar-month-container');
  if (!container) return;

  const year = currentCalDate.getFullYear();
  const month = currentCalDate.getMonth();
  const monthName = currentCalDate.toLocaleString('default', { month: 'long', year: 'numeric' });

  const firstDayIndex = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();

  const daysHeader = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    .map(d => `<div class="cal-day-header">${d}</div>`).join('');

  let dayCells = '';

  for (let i = 0; i < firstDayIndex; i++) {
    dayCells += `<div class="cal-day-cell other-month"></div>`;
  }

  const todayStr = new Date().toISOString().split('T')[0];

  for (let day = 1; day <= lastDate; day++) {
    const dStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const sessions = window.sessionsByDateMap[dStr] || [];
    const isToday = dStr === todayStr;
    const isSelected = dStr === selectedDateStr;

    let dotsHtml = '';
    if (sessions.length > 0) {
      const hasAttended = sessions.some(s => s.status === 'PRESENT');
      const hasOngoing = sessions.some(s => s.status === 'ONGOING');
      const hasMissed = sessions.some(s => s.status === 'ABSENT');

      if (hasAttended) dotsHtml += `<span class="cal-dot green" title="Attended"></span>`;
      if (hasOngoing) dotsHtml += `<span class="cal-dot" title="Live class in progress" style="background:#3b82f6;"></span>`;
      if (hasMissed) dotsHtml += `<span class="cal-dot red" title="Missed (Session ended)"></span>`;
    }

    dayCells += `
      <div class="cal-day-cell ${isToday ? 'today' : ''} ${isSelected ? 'selected-day' : ''}" onclick="window.renderSidePanelDayDetails('${dStr}')">
        <span class="cal-day-num">${day}</span>
        <div class="cal-dots">${dotsHtml}</div>
      </div>`;
  }

  container.innerHTML = `
    <div class="calendar-month-header">
      <button type="button" class="btn btn-ghost btn-sm" onclick="window.changeCalMonth(-1)">← Prev</button>
      <span class="calendar-month-title">${monthName}</span>
      <button type="button" class="btn btn-ghost btn-sm" onclick="window.changeCalMonth(1)">Next →</button>
    </div>
    <div class="calendar-month-grid">
      ${daysHeader}
      ${dayCells}
    </div>
  `;

  renderSidePanelDayDetails(selectedDateStr || todayStr);
}

function changeCalMonth(delta) {
  currentCalDate.setMonth(currentCalDate.getMonth() + delta);
  renderInteractiveCalendar();
}

// ── Render Day Details in Side Panel (Attended vs Ongoing vs Missed) ─────
function renderSidePanelDayDetails(dateStr) {
  selectedDateStr = dateStr;
  const sessions = window.sessionsByDateMap[dateStr] || [];

  const titleEl = document.getElementById('side-panel-title');
  const subEl = document.getElementById('side-panel-subtitle');
  const contentEl = document.getElementById('side-panel-content');

  let formattedDate = dateStr;
  try {
    formattedDate = new Date(dateStr + 'T00:00:00').toLocaleDateString([], {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
    });
  } catch (_) {}

  if (titleEl) titleEl.textContent = `📅 ${formattedDate}`;
  if (subEl) subEl.textContent = sessions.length ? `${sessions.length} class session(s) conducted` : 'No classes held on this date';

  if (contentEl) {
    if (!sessions.length) {
      contentEl.innerHTML = `
        <div class="empty-state" style="padding:1rem 0.5rem;text-align:center;">
          <p style="font-size:0.8rem;color:var(--text-muted);">No class sessions conducted on ${formattedDate}.</p>
        </div>`;
    } else {
      contentEl.innerHTML = sessions.map(s => {
        let badge = '';
        if (s.status === 'PRESENT') {
          badge = `<span class="badge badge-green">Attended ✓</span>`;
        } else if (s.status === 'ONGOING') {
          badge = `<span class="badge badge-blue">Live Session ▶ (In Progress)</span>`;
        } else {
          badge = `<span class="badge badge-red">Missed ❌</span>`;
        }

        const meta = s.status === 'PRESENT'
          ? `🕒 Check-in: ${s.timeString} &nbsp;|&nbsp; 📍 ${s.distanceMeters != null ? s.distanceMeters + 'm' : 'Verified'}`
          : s.status === 'ONGOING'
            ? `Instructor: ${s.teacherName} (Class ongoing right now — click Verify Face & Scan above)`
            : `Instructor: ${s.teacherName} (Class ended at ${s.timeString})`;

        return `
          <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.65rem;">
            <div class="flex items-center justify-between mb-1">
              <strong style="font-size:0.82rem;">${s.courseCode}</strong>
              ${badge}
            </div>
            <div style="font-size:0.75rem;color:var(--text-secondary);">${s.className}</div>
            <div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.2rem;">${meta}</div>
          </div>`;
      }).join('');
    }
  }
}

// ── Subject Analytics & Attendance Synchronization ──────────────────────
async function loadAnalytics() {
  try {
    const res = await fetch(`${API}/api/attendance/analytics`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    });
    if (!res.ok) {
      if (res.status === 401) logout();
      return;
    }

    const data = await res.json();
    window.sessionsByDateMap = data.sessionsByDate || {};

    // 1. Render Subject Percentage Stats
    const statsList = document.getElementById('subject-stats-list');
    if (statsList) {
      if (!data.subjects || !data.subjects.length) {
        statsList.innerHTML = `<div class="empty-state"><p>You are not enrolled in any courses yet</p></div>`;
      } else {
        statsList.innerHTML = data.subjects.map(s => {
          const colorClass = s.percentage >= 75 ? 'var(--accent-success)' : 'var(--accent-danger)';
          const badge = s.percentage >= 75
            ? `<span class="badge badge-green">Eligible (${s.percentage}%)</span>`
            : `<span class="badge badge-red">Low Attendance (${s.percentage}%)</span>`;

          return `
            <div class="subject-card">
              <div class="flex items-center justify-between">
                <div>
                  <strong>${s.courseCode}</strong> <span style="font-size:0.85rem;color:var(--text-secondary);">${s.courseName}</span>
                  <div style="font-size:0.78rem;color:var(--text-muted);margin-top:0.15rem;">
                    Teacher: ${s.teacherName} &nbsp;|&nbsp; Attended: <strong>${s.attendedSessions} / ${s.totalEndedSessions}</strong> ended classes
                  </div>
                </div>
                ${badge}
              </div>
              <div class="progress-bar-bg">
                <div class="progress-bar-fill" style="width:${s.percentage}%;background:${colorClass};"></div>
              </div>
            </div>`;
        }).join('');
      }
    }

    // 2. Render Compact Calendar Grid
    renderInteractiveCalendar();

  } catch (err) {
    console.error('Analytics load error:', err);
  }
}

// Global Exports
window.openFaceEnrollmentModal = openFaceEnrollmentModal;
window.closeFaceEnrollmentModal = closeFaceEnrollmentModal;
window.captureAndSaveFaceProfile = captureAndSaveFaceProfile;
window.startBiometricScanWorkflow = startBiometricScanWorkflow;
window.flipFaceCamera = flipFaceCamera;
window.flipQRCamera = flipQRCamera;
window.flipEnrollCamera = flipEnrollCamera;
window.resetScanner = resetScanner;
window.resetFaceProfile = resetFaceProfile;
window.submitManualToken = submitManualToken;
window.loadAnalytics = loadAnalytics;
window.changeCalMonth = changeCalMonth;
window.renderSidePanelDayDetails = renderSidePanelDayDetails;
window.logout = logout;

// ── Bind Event Listeners ────────────────────────────────────────────────
function bindStudentEventListeners() {
  document.getElementById('setup-face-btn')?.addEventListener('click', openFaceEnrollmentModal);
  document.getElementById('btn-close-enroll-face-modal')?.addEventListener('click', closeFaceEnrollmentModal);
  document.getElementById('btn-cancel-enroll-face-modal')?.addEventListener('click', closeFaceEnrollmentModal);
  document.getElementById('capture-face-btn')?.addEventListener('click', captureAndSaveFaceProfile);
  document.getElementById('btn-start-biometric-scan')?.addEventListener('click', startBiometricScanWorkflow);
  document.getElementById('btn-flip-face-camera')?.addEventListener('click', flipFaceCamera);
  document.getElementById('btn-flip-qr-camera')?.addEventListener('click', flipQRCamera);
  document.getElementById('btn-flip-enroll-camera')?.addEventListener('click', flipEnrollCamera);
  document.getElementById('btn-reset-scanner')?.addEventListener('click', resetScanner);
  document.getElementById('re-enroll-face-btn')?.addEventListener('click', resetFaceProfile);
  document.getElementById('btn-submit-manual-token')?.addEventListener('click', submitManualToken);
  document.getElementById('btn-refresh-analytics')?.addEventListener('click', loadAnalytics);
  document.getElementById('logout-btn')?.addEventListener('click', logout);
}

// ── Init & Real-Time Sync Polling ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  bindStudentEventListeners();
  checkFaceProfileStatus();
  loadAnalytics();

  setInterval(loadAnalytics, 6000);
});

if (document.readyState !== 'loading') {
  bindStudentEventListeners();
  checkFaceProfileStatus();
  loadAnalytics();
}
