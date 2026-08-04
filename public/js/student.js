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

    if (data.hasFaceProfile) {
      userFaceProfile = data.faceDescriptor;
      isFaceLocked = true;
      if (setupCard) setupCard.style.display = 'none';
    } else {
      isFaceLocked = false;
      userFaceProfile = null;
      if (setupCard) setupCard.style.display = 'block';
    }
  } catch (err) {
    console.error('Face profile status check error:', err);
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

// Extract face descriptor, nose tip, and 3D feature ratio for liveness analysis
async function extractFaceDetails(videoElement) {
  if (!faceApiReady) await loadFaceApiModels();
  const detection = await faceapi
    .detectSingleFace(videoElement, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!detection) return null;

  const landmarks = detection.landmarks;
  const nose = landmarks.getNose();
  const leftEye = landmarks.getLeftEye();
  const rightEye = landmarks.getRightEye();
  const jaw = landmarks.getJawOutline();

  let featureRatio = 0.35;
  if (leftEye && rightEye && jaw && jaw.length >= 17) {
    const eyeDist = Math.hypot(leftEye[0].x - rightEye[3].x, leftEye[0].y - rightEye[3].y);
    const jawWidth = Math.hypot(jaw[0].x - jaw[16].x, jaw[0].y - jaw[16].y);
    if (jawWidth > 0) featureRatio = eyeDist / jawWidth;
  }

  return {
    descriptor: Array.from(detection.descriptor),
    noseTip: nose && nose.length > 3 ? { x: nose[3].x, y: nose[3].y } : null,
    featureRatio
  };
}

// Extract Float32Array → Array descriptor
async function extractFaceDescriptor(videoElement) {
  const details = await extractFaceDetails(videoElement);
  return details ? details.descriptor : null;
}

// Euclidean distance between two 128-D descriptors.
function faceDistance(descA, descB) {
  if (!descA || !descB || descA.length !== descB.length) return 999;
  let sum = 0;
  for (let i = 0; i < descA.length; i++) sum += (descA[i] - descB[i]) ** 2;
  return Math.sqrt(sum);
}

// Match threshold: euclidean distance < 0.55 = same person
const FACE_MATCH_THRESHOLD = 0.55;

// ── Face Profile Enrollment Modal ───────────────────────────────────────
function openFaceEnrollmentModal() {
  if (isFaceLocked) {
    alert('Facial profile is already locked.');
    return;
  }
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
  if (isFaceLocked) return alert('Facial profile is already locked.');

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

async function flipFaceCamera() {
  faceFacingMode = faceFacingMode === 'user' ? 'environment' : 'user';
  await stopCameraStream();
  startBiometricScanWorkflow();
}

async function flipQRCamera() {
  qrFacingMode = qrFacingMode === 'user' ? 'environment' : 'user';
  await openQRScannerCamera();
}

async function flipEnrollCamera() {
  faceFacingMode = faceFacingMode === 'user' ? 'environment' : 'user';
  await stopCameraStream();
  startEnrollCamera();
}

// ── STEP 1: Face-First Scan Workflow (Neural Face Match + Anti-Video/Photo Liveness) ──
async function startBiometricScanWorkflow() {
  if (!userFaceProfile) {
    alert('Please register your Facial Profile first before marking attendance.');
    return;
  }

  await stopCameraStream();
  await new Promise(r => setTimeout(r, 100));

  document.getElementById('scan-prompt').classList.add('hidden');
  document.getElementById('face-verification-view').classList.remove('hidden');
  document.getElementById('qr-reader-container').classList.add('hidden');

  const promptEl = document.getElementById('liveness-prompt');
  const subtextEl = document.getElementById('liveness-subtext');

  promptEl.textContent = '👤 Look at the camera to verify identity…';
  promptEl.style.color = '#fbbf24';
  subtextEl.textContent = 'Analyzing neural face descriptor…';

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
  let verificationAttempts = 0;
  let matchCount = 0;
  let prevNoseTip = null;
  let staticFrameCount = 0;
  let ratioBuffer = [];
  let rigidPhotoCount = 0;

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

    if (video.videoWidth > 0) {
      try {
        const details = await extractFaceDetails(video);

        if (!details) {
          promptEl.textContent = '👤 Position your face in camera…';
          promptEl.style.color = '#fbbf24';
          matchCount = 0;
          staticFrameCount = 0;
          rigidPhotoCount = 0;
          ratioBuffer = [];
        } else {
          const { descriptor, noseTip, featureRatio } = details;

          // 1. Static Photo Detection (Zero movement across frames)
          if (noseTip && prevNoseTip) {
            const movement = Math.hypot(noseTip.x - prevNoseTip.x, noseTip.y - prevNoseTip.y);
            if (movement < 0.04) {
              staticFrameCount++;
            } else {
              staticFrameCount = Math.max(0, staticFrameCount - 1);
            }
          }
          if (noseTip) prevNoseTip = noseTip;

          // 2. Moving Photo / Screen Video Playback Detection (Zero 3D non-rigid variance)
          ratioBuffer.push(featureRatio);
          if (ratioBuffer.length > 5) ratioBuffer.shift();

          if (ratioBuffer.length >= 5) {
            const avg = ratioBuffer.reduce((a, b) => a + b, 0) / ratioBuffer.length;
            const variance = ratioBuffer.reduce((sum, r) => sum + (r - avg) ** 2, 0) / ratioBuffer.length;

            // If object is moving in frame but 2D feature ratio variance is 0.00000 (flat 2D object scaling)
            if (staticFrameCount === 0 && variance < 0.000002) {
              rigidPhotoCount++;
            } else {
              rigidPhotoCount = Math.max(0, rigidPhotoCount - 1);
            }
          }

          const dist = faceDistance(userFaceProfile, descriptor);

          if (staticFrameCount >= 10) {
            promptEl.textContent = '⚠️ Static photo detected — please present your live face';
            promptEl.style.color = '#f87171';
            subtextEl.textContent = 'Static photo detected. Please use a live camera stream.';
            matchCount = 0;
          } else if (rigidPhotoCount >= 8) {
            promptEl.textContent = '⚠️ Screen video / moving photo detected';
            promptEl.style.color = '#f87171';
            subtextEl.textContent = '2D screen video playback detected. Please use live camera.';
            matchCount = 0;
          } else if (dist < FACE_MATCH_THRESHOLD) {
            matchCount++;
            promptEl.textContent = '✓ Face Verified!';
            promptEl.style.color = '#4ade80';
            subtextEl.textContent = 'Identity confirmed. Opening QR scanner…';
            
            if (matchCount >= 2) {
              setTimeout(async () => {
                cleanupVerificationView();
                await openQRScannerCamera();
              }, 400);
              return;
            }
          } else {
            matchCount = 0;
            verificationAttempts++;
            if (verificationAttempts >= 8) {
              promptEl.textContent = '❌ Face Not Recognised!';
              promptEl.style.color = '#f87171';
              subtextEl.textContent = 'Face does not match registered profile.';
              setScanStatus('Biometric rejected — face does not match registered profile.', 'error');
              cleanupVerificationView();
              document.getElementById('scan-prompt').classList.remove('hidden');
              isProcessing = false;
              return;
            } else {
              promptEl.textContent = `⚠️ Face mismatch (attempt ${verificationAttempts}/8) — hold still…`;
              promptEl.style.color = '#fbbf24';
            }
          }
        }
      } catch (e) {
        console.warn('face-api detection error:', e);
      }
    }

    await new Promise(r => setTimeout(r, 200));
    livenessLoopId = requestAnimationFrame(checkFrame);
  }

  livenessLoopId = requestAnimationFrame(checkFrame);
}

// ── STEP 2: Open Camera QR Scanner (Triggered ONLY after Face Match) ───
async function openQRScannerCamera() {
  await stopCameraStream();
  await new Promise(r => setTimeout(r, 100));

  document.getElementById('scan-prompt').classList.add('hidden');
  document.getElementById('face-verification-view').classList.add('hidden');
  document.getElementById('qr-reader-container').classList.remove('hidden');

  setScanStatus('📷 Point camera at teacher\'s rotating QR code', 'info');

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

  await stopCameraStream();

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

  setScanStatus('📍 Requesting GPS location & submitting check-in…', 'info');

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

async function stopCameraStream() {
  if (activeStream) {
    try {
      activeStream.getTracks().forEach(t => t.stop());
    } catch (_) {}
    activeStream = null;
  }

  const faceVideo = document.getElementById('face-video');
  if (faceVideo && faceVideo.srcObject) {
    try { faceVideo.srcObject.getTracks().forEach(t => t.stop()); } catch (_) {}
    faceVideo.srcObject = null;
  }

  const enrollVideo = document.getElementById('enroll-video');
  if (enrollVideo && enrollVideo.srcObject) {
    try { enrollVideo.srcObject.getTracks().forEach(t => t.stop()); } catch (_) {}
    enrollVideo.srcObject = null;
  }

  if (html5QrCode) {
    try {
      if (html5QrCode.isScanning) {
        await html5QrCode.stop();
      }
      await html5QrCode.clear();
    } catch (_) {}
    html5QrCode = null;
  }

  document.querySelectorAll('#qr-reader video').forEach(v => {
    if (v.srcObject) {
      try { v.srcObject.getTracks().forEach(t => t.stop()); } catch (_) {}
      v.srcObject = null;
    }
  });
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
  document.getElementById('qr-reader-container')?.classList.add('hidden');

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

async function resetScanner() {
  await stopCameraStream();
  document.getElementById('success-view').classList.add('hidden');
  document.getElementById('scan-prompt').classList.remove('hidden');
  document.getElementById('qr-reader').classList.add('hidden');
  document.getElementById('qr-reader-container')?.classList.add('hidden');
  document.getElementById('face-verification-view').classList.add('hidden');
  setScanStatus('', '');
  isProcessing = false;
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

  const now = new Date();
  const year = currentCalDate.getFullYear();
  const month = currentCalDate.getMonth();
  const monthName = currentCalDate.toLocaleString('default', { month: 'long', year: 'numeric' });

  // Calculate month difference from current month (1-year past limit = 12 months)
  const monthsDiff = (now.getFullYear() - year) * 12 + (now.getMonth() - month);
  const canGoPrev = monthsDiff < 12;
  const canGoNext = monthsDiff > 0;

  const firstDayIndex = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();

  const daysHeader = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    .map(d => `<div class="cal-day-header">${d}</div>`).join('');

  let dayCells = '';

  for (let i = 0; i < firstDayIndex; i++) {
    dayCells += `<div class="cal-day-cell other-month"></div>`;
  }

  const todayStr = now.toISOString().split('T')[0];

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
      if (hasOngoing) dotsHtml += `<span class="cal-dot blue" title="Live class in progress"></span>`;
      if (hasMissed) dotsHtml += `<span class="cal-dot red" title="Missed"></span>`;
    }

    dayCells += `
      <div class="cal-day-cell ${isToday ? 'today' : ''} ${isSelected ? 'selected-day' : ''} ${!sessions.length ? 'has-no-class' : ''}" onclick="window.selectCalendarDate('${dStr}')">
        <span class="cal-day-num">${day}</span>
        <div class="cal-dots">${dotsHtml}</div>
      </div>`;
  }

  const isCurrentMonth = monthsDiff === 0;

  container.innerHTML = `
    <div class="calendar-month-header">
      <div class="flex items-center gap-1">
        <button type="button" class="btn btn-ghost btn-sm" ${!canGoPrev ? 'disabled' : ''} onclick="window.changeCalMonth(-1)">← Prev</button>
        <button type="button" class="btn btn-ghost btn-sm" ${!canGoNext ? 'disabled' : ''} onclick="window.changeCalMonth(1)">Next →</button>
        ${!isCurrentMonth ? `<button type="button" class="btn btn-ghost btn-sm" style="color:var(--accent-primary);" onclick="window.resetToCurrentMonth()">Today</button>` : ''}
      </div>
      <div class="flex items-center gap-1">
        <span class="calendar-month-title">${monthName}</span>
        ${monthsDiff > 0 ? `<span class="badge badge-purple" style="font-size:0.7rem;">Past History (${monthsDiff}m ago)</span>` : ''}
      </div>
    </div>
    <div class="calendar-month-grid">
      ${daysHeader}
      ${dayCells}
    </div>
  `;

  renderSidePanelDayDetails(selectedDateStr || todayStr);
}

function changeCalMonth(delta) {
  const now = new Date();
  const target = new Date(currentCalDate.getFullYear(), currentCalDate.getMonth() + delta, 1);
  const monthsDiff = (now.getFullYear() - target.getFullYear()) * 12 + (now.getMonth() - target.getMonth());

  // Restrict navigation between current month and 12 months in the past
  if (monthsDiff >= 0 && monthsDiff <= 12) {
    currentCalDate = target;
    renderInteractiveCalendar();
  }
}

function resetToCurrentMonth() {
  currentCalDate = new Date();
  selectedDateStr = new Date().toISOString().split('T')[0];
  renderInteractiveCalendar();
}

function selectCalendarDate(dateStr) {
  selectedDateStr = dateStr;
  renderInteractiveCalendar();
}

// ── Render Day Details in Side Panel (Attended vs Ongoing vs Missed vs No Class) ─────
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
  if (subEl) subEl.textContent = sessions.length ? `${sessions.length} class session(s) held` : 'No Class Scheduled';

  if (contentEl) {
    if (!sessions.length) {
      contentEl.innerHTML = `
        <div style="padding:1.5rem 1rem;text-align:center;background:rgba(255,255,255,0.02);border:1px dashed var(--border);border-radius:var(--radius-sm);margin-top:0.5rem;">
          <div style="font-size:1.8rem;margin-bottom:0.4rem;">☕</div>
          <strong style="font-size:0.9rem;color:var(--text-primary);display:block;">No Class Scheduled</strong>
          <p style="font-size:0.78rem;color:var(--text-muted);margin-top:0.25rem;">No lecture sessions were held on ${formattedDate}.</p>
        </div>`;
    } else {
      contentEl.innerHTML = sessions.map(s => {
        let badge = '';
        if (s.status === 'PRESENT') {
          badge = `<span class="badge badge-green">✓ Attended</span>`;
        } else if (s.status === 'ONGOING') {
          badge = `<span class="badge badge-blue">▶ Live Class</span>`;
        } else {
          badge = `<span class="badge badge-red">❌ Missed Class</span>`;
        }

        const meta = s.status === 'PRESENT'
          ? `🕒 Check-in: ${s.timeString} &nbsp;|&nbsp; 📍 ${s.distanceMeters != null ? s.distanceMeters + 'm' : 'Verified'}`
          : s.status === 'ONGOING'
            ? `Instructor: ${s.teacherName} (Class live now — click Verify Face & Scan above)`
            : `Instructor: ${s.teacherName} (Ended at ${s.timeString})`;

        return `
          <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.75rem;">
            <div class="flex items-center justify-between mb-1">
              <strong style="font-size:0.85rem;color:var(--text-primary);">${s.courseCode}</strong>
              ${badge}
            </div>
            <div style="font-size:0.78rem;color:var(--text-secondary);">${s.className}</div>
            <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.3rem;">${meta}</div>
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
window.submitManualToken = submitManualToken;
window.loadAnalytics = loadAnalytics;
window.changeCalMonth = changeCalMonth;
window.resetToCurrentMonth = resetToCurrentMonth;
window.selectCalendarDate = selectCalendarDate;
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
