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
// ── WebAuthn Passkeys State ──────────────────────────────────────────────
let isPasskeyRegistered = false;

// Check Passkey Status on Page Load
async function checkFaceProfileStatus() {
  try {
    const res = await fetch(`${API}/api/auth/webauthn-status`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    });
    if (!res.ok) {
      if (res.status === 401) logout();
      return;
    }
    const data = await res.json();
    isPasskeyRegistered = data.isRegistered;

    const setupCard = document.getElementById('card-passkey-setup');
    const badge = document.getElementById('passkey-status-badge');

    if (data.isRegistered) {
      if (badge) {
        badge.textContent = '✓ Passkey Active';
        badge.className = 'badge badge-green';
      }
      if (setupCard) setupCard.style.display = 'none';
    } else {
      if (badge) {
        badge.textContent = 'Not Registered';
        badge.className = 'badge badge-red';
      }
      if (setupCard) setupCard.style.display = 'block';
    }
  } catch (err) {
    console.error('Passkey status check error:', err);
  }
}

// Register Hardware Passkey (TouchID / FaceID / Windows Hello / Android Fingerprint)
async function setupPasskey() {
  try {
    setScanStatus('📍 Requesting hardware Passkey registration options…', 'info');

    const optsRes = await fetch(`${API}/api/auth/webauthn/register-options`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}` }
    });

    if (!optsRes.ok) {
      const errData = await optsRes.json();
      return alert('Error: ' + (errData.error || 'Failed to start Passkey setup'));
    }

    const options = await optsRes.json();

    // Trigger native browser WebAuthn prompt (TouchID / FaceID / Windows Hello / Fingerprint)
    let attResp;
    try {
      attResp = await SimpleWebAuthnBrowser.startRegistration(options);
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        return alert('Registration canceled or timed out.');
      }
      return alert('Hardware Biometrics error: ' + err.message);
    }

    // Verify registration response on server
    const verifyRes = await fetch(`${API}/api/auth/webauthn/register-verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`
      },
      body: JSON.stringify(attResp)
    });

    const verifyData = await verifyRes.json();

    if (verifyRes.ok && verifyData.verified) {
      alert('✓ Hardware Passkey (TouchID / FaceID) registered successfully!');
      checkFaceProfileStatus();
    } else {
      alert('Passkey verification failed: ' + (verifyData.error || 'Unknown error'));
    }
  } catch (err) {
    console.error('setupPasskey error:', err);
    alert('Passkey setup error: ' + err.message);
  }
}

// ── 30-Second Biometric Verification Expiry Timer State ──────────
let biometricVerifiedAt = null;
let verificationTimerInterval = null;
let isBiometricVerified = false;

// ── 30-Second Biometric Verification Expiry Timer State ──────────
let biometricVerifiedAt = null;
let verificationTimerInterval = null;
let isBiometricVerified = false;

function stopVerificationTimer() {
  if (verificationTimerInterval) clearInterval(verificationTimerInterval);
  verificationTimerInterval = null;
  const timerContainer = document.getElementById('verification-timer-container');
  if (timerContainer) timerContainer.classList.add('hidden');
}

function start30SecVerificationTimer() {
  stopVerificationTimer();
  isBiometricVerified = true;
  biometricVerifiedAt = Date.now();

  const timerContainer = document.getElementById('verification-timer-container');
  const timerSecsEl = document.getElementById('timer-seconds');
  const bar = document.getElementById('verification-progress-bar');
  if (timerContainer) timerContainer.classList.remove('hidden');

  const DURATION_MS = 30000;

  verificationTimerInterval = setInterval(() => {
    const elapsed = Date.now() - biometricVerifiedAt;
    const remainingMs = DURATION_MS - elapsed;
    const remainingSecs = Math.max(0, Math.ceil(remainingMs / 1000));

    if (timerSecsEl) timerSecsEl.textContent = remainingSecs;
    if (bar) {
      const pct = Math.max(0, (remainingMs / DURATION_MS) * 100);
      bar.style.width = pct.toFixed(1) + '%';
    }

    if (remainingMs <= 0) {
      // 30 SECONDS EXPIRED! Invalidate verification status
      stopVerificationTimer();
      stopCameraStream();
      isBiometricVerified = false;

      document.getElementById('scan-prompt')?.classList.remove('hidden');
      document.getElementById('qr-reader-container')?.classList.add('hidden');

      setScanStatus('⏱️ 30-second biometric verification window expired. Please tap Verify Touch ID to scan again.', 'warning');
    }
  }, 100);
}

// Hardware Biometrics Scan Workflow: Verify Touch ID -> Open QR Scanner Camera
async function startBiometricScanWorkflow() {
  if (!isPasskeyRegistered) {
    alert('Please register your Hardware Touch ID / Fingerprint Passkey first before marking attendance.');
    return;
  }

  setScanStatus('☝️ Please scan Touch ID / Fingerprint on your device…', 'info');

  try {
    // 1. Fetch authentication challenge options
    const authOptsRes = await fetch(`${API}/api/auth/webauthn/authenticate-options`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}` }
    });

    if (!authOptsRes.ok) {
      const errData = await authOptsRes.json();
      return setScanStatus(errData.error || 'Failed to initialize Touch ID verification', 'error');
    }

    const authOptions = await authOptsRes.json();

    // 2. Trigger native OS WebAuthn Touch ID / Fingerprint prompt
    let asseResp;
    try {
      asseResp = await SimpleWebAuthnBrowser.startAuthentication(authOptions);
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        return setScanStatus('Authentication canceled. Please tap Touch ID / Fingerprint to proceed.', 'error');
      }
      return setScanStatus('Touch ID error: ' + err.message, 'error');
    }

    // 3. Verify hardware signature on server
    const verifyRes = await fetch(`${API}/api/auth/webauthn/authenticate-verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`
      },
      body: JSON.stringify(asseResp)
    });

    const verifyData = await verifyRes.json();

    if (verifyRes.ok && verifyData.verified) {
      setScanStatus('✓ Touch ID Verified! Opening QR scanner camera (30s window active)…', 'success');
      document.getElementById('scan-prompt').classList.add('hidden');
      start30SecVerificationTimer();
      await openQRScannerCamera();
    } else {
      setScanStatus('Touch ID verification failed: ' + (verifyData.error || 'Signature invalid'), 'error');
    }
  } catch (err) {
    console.error('startBiometricScanWorkflow error:', err);
    setScanStatus('Touch ID verification error: ' + err.message, 'error');
  }
}

let qrFacingMode = 'environment';

async function flipQRCamera() {
  qrFacingMode = qrFacingMode === 'user' ? 'environment' : 'user';
  await openQRScannerCamera();
}

// ── STEP 2: Open Camera QR Scanner (Triggered ONLY after Passkey Biometrics) ───
async function openQRScannerCamera() {
  await stopCameraStream();
  await new Promise(r => setTimeout(r, 100));

  document.getElementById('scan-prompt')?.classList.add('hidden');
  document.getElementById('face-verification-view')?.classList.add('hidden');
  document.getElementById('qr-reader-container')?.classList.remove('hidden');

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
      // Retry once with extended timeout for fresh hardware GPS fix
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          await submitAttendance(payload.sessionId, payload.token, pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
        },
        (err2) => {
          setScanStatus('Location error: ' + err2.message, 'error');
          isProcessing = false;
        },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
      );
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
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
      stopVerificationTimer();
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
  document.getElementById('scan-prompt')?.classList.remove('hidden');
  document.getElementById('qr-reader')?.classList.add('hidden');
  document.getElementById('qr-reader-container')?.classList.add('hidden');
  document.getElementById('face-verification-view')?.classList.add('hidden');
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
      <div class="cal-day-cell ${isToday ? 'today' : ''} ${isSelected ? 'selected-day' : ''}" onclick="window.selectCalendarDate('${dStr}')">
        <span class="cal-day-num">${day}</span>
        <div class="cal-dots">${dotsHtml}</div>
      </div>`;
  }

  const isCurrentMonth = (now.getFullYear() === year && now.getMonth() === month);

  container.innerHTML = `
    <div class="calendar-month-header">
      <div class="calendar-month-title">${monthName}</div>
      <div class="calendar-nav-group">
        <button type="button" class="cal-nav-btn" id="cal-prev-btn" title="Previous Month">◀</button>
        <button type="button" class="cal-nav-btn" id="cal-next-btn" title="Next Month">▶</button>
        ${!isCurrentMonth ? `<button type="button" class="cal-today-btn" id="cal-today-btn">📆 Today</button>` : ''}
      </div>
    </div>
    <div class="calendar-month-grid">
      ${daysHeader}
      ${dayCells}
    </div>
    <div class="calendar-legend">
      <div class="legend-item"><span class="cal-dot green"></span> Attended</div>
      <div class="legend-item"><span class="cal-dot blue"></span> Live Class</div>
      <div class="legend-item"><span class="cal-dot red"></span> Missed</div>
      <div class="legend-item"><span style="width:6px;height:6px;border-radius:50%;background:var(--border);"></span> Off Day</div>
    </div>
  `;

  // Attach controls event listeners directly
  document.getElementById('cal-prev-btn')?.addEventListener('click', () => changeCalMonth(-1));
  document.getElementById('cal-next-btn')?.addEventListener('click', () => changeCalMonth(1));
  document.getElementById('cal-today-btn')?.addEventListener('click', () => resetToCurrentMonth());

  renderSidePanelDayDetails(selectedDateStr || todayStr);
}

function changeCalMonth(delta) {
  currentCalDate = new Date(currentCalDate.getFullYear(), currentCalDate.getMonth() + delta, 1);
  renderInteractiveCalendar();
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

// ── Render Day Details in Side Panel ─────────────────────────────────────
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

  if (contentEl) {
    if (!sessions.length) {
      if (subEl) subEl.textContent = 'No Lectures Recorded';
      contentEl.innerHTML = `
        <div style="padding:1.25rem 1rem;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);text-align:center;">
          <div style="font-size:1.6rem;margin-bottom:0.3rem;">🌴</div>
          <strong style="font-size:0.88rem;color:var(--text-primary);display:block;">Off Day / Holiday</strong>
          <p style="font-size:0.78rem;color:var(--text-muted);margin-top:0.25rem;line-height:1.4;">
            No lecture sessions were held on this date.
          </p>
          <div style="margin-top:0.75rem;padding-top:0.6rem;border-top:1px solid var(--border);font-size:0.72rem;color:var(--accent-primary);font-weight:600;">
            💡 Select colored calendar dates to view class attendance.
          </div>
        </div>`;
    } else {
      if (subEl) subEl.textContent = `${sessions.length} class session(s) conducted`;
      contentEl.innerHTML = sessions.map(s => {
        let badge = '';
        if (s.status === 'PRESENT') {
          badge = `<span class="badge badge-green">✓ Attended</span>`;
        } else if (s.status === 'ONGOING') {
          badge = `<span class="badge badge-blue">▶ Live Class</span>`;
        } else {
          badge = `<span class="badge badge-red">❌ Missed</span>`;
        }

        const meta = s.status === 'PRESENT'
          ? `🕒 Check-in: ${s.timeString} &nbsp;|&nbsp; 📍 ${s.distanceMeters != null ? s.distanceMeters + 'm' : 'Verified'}`
          : s.status === 'ONGOING'
            ? `Instructor: ${s.teacherName} (Class in progress)`
            : `Instructor: ${s.teacherName} (Ended at ${s.timeString})`;

        return `
          <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.85rem;">
            <div class="flex items-center justify-between mb-1">
              <strong style="font-size:0.88rem;color:var(--text-primary);">${s.courseCode}</strong>
              ${badge}
            </div>
            <div style="font-size:0.8rem;color:var(--text-secondary);font-weight:500;">${s.className}</div>
            <div style="font-size:0.73rem;color:var(--text-muted);margin-top:0.4rem;">${meta}</div>
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
window.setupPasskey = setupPasskey;
window.startBiometricScanWorkflow = startBiometricScanWorkflow;
window.flipQRCamera = flipQRCamera;
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
  document.getElementById('setup-passkey-btn')?.addEventListener('click', setupPasskey);
  document.getElementById('btn-start-biometric-scan')?.addEventListener('click', startBiometricScanWorkflow);
  document.getElementById('btn-flip-qr-camera')?.addEventListener('click', flipQRCamera);
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
