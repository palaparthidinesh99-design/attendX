/* teacher.js — course-first workflow, session control, rotating QR, live attendance, CSV export */

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
  if (user.role !== 'teacher') return (window.location.href = '/student.html');
  const navName = document.getElementById('nav-name');
  if (navName) navName.textContent = user.name;
})();

// ── State & Memory Map ──────────────────────────────────────────────────
window.coursesMap = {};
let selectedCourse = null;
let activeSessionId = null;
let qrPollInterval = null;
let attendancePollInterval = null;
let countdownInterval = null;
let qrCodeInstance = null;
let popoutWindow = null;
let popoutQRInstance = null;
let lastQRPayload = '';
let currentLiveCount = 0;
let pipVideo = null;
let pipCanvas = null;

// ── Helpers ─────────────────────────────────────────────────────────────
function authHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` };
}

function showEl(id)  { document.getElementById(id)?.classList.remove('hidden'); }
function hideEl(id)  { document.getElementById(id)?.classList.add('hidden'); }

function setStatus(id, msg, type = 'error') {
  const el = document.getElementById(id);
  if (!el) return;
  if (!msg) { el.innerHTML = ''; return; }
  const cls = type === 'success' ? 'alert-success' : type === 'info' ? 'alert-info' : type === 'warning' ? 'alert-warning' : 'alert-error';
  el.innerHTML = `<div class="alert ${cls} mt-1">${msg}</div>`;
  if (type === 'success') setTimeout(() => { if (el) el.innerHTML = ''; }, 4000);
}

// ── Navigation Views ────────────────────────────────────────────────────
function showCoursesList() {
  stopPolling();
  selectedCourse = null;
  activeSessionId = null;
  hideEl('view-course-workspace');
  showEl('view-courses-list');
  loadCourses();
}

// ── Load & Render Course Cards ──────────────────────────────────────────
async function loadCourses() {
  try {
    const res = await fetch(`${API}/api/courses`, { headers: authHeaders() });
    if (!res.ok) {
      if (res.status === 401) logout();
      return;
    }

    const courses = await res.json();
    const container = document.getElementById('courses-grid-container');

    if (!container) return;

    window.coursesMap = {};
    if (!courses || !courses.length) {
      container.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1;">
          <p>No courses created yet. Click "+ Create New Course" above to add your first subject!</p>
        </div>`;
      return;
    }

    courses.forEach(c => { window.coursesMap[c._id] = c; });

    container.innerHTML = courses.map(c => `
      <div class="course-card" data-course-id="${c._id}">
        <span class="badge badge-purple mb-1">${c.courseCode}</span>
        <h3 style="margin-top:0.2rem;">${c.courseName}</h3>
        <p style="font-size:0.8rem;margin-top:0.35rem;color:var(--text-muted);">
          👥 ${c.enrolledEmails ? c.enrolledEmails.length : 0} enrolled students
        </p>
        <button type="button" class="btn btn-ghost btn-sm btn-full mt-2" data-course-id="${c._id}">
          Open Course Workspace →
        </button>
      </div>
    `).join('');

    if (!container.dataset.hasListener) {
      container.dataset.hasListener = 'true';
      container.addEventListener('click', (e) => {
        const card = e.target.closest('[data-course-id]');
        if (card) {
          const courseId = card.getAttribute('data-course-id');
          if (courseId) openCourseWorkspace(courseId);
        }
      });
    }
  } catch (err) {
    console.error('Course load error:', err);
  }
}

// ── Open Course Workspace (Memory Map — Instant 0ms Lag) ───────────────
async function openCourseWorkspace(courseId) {
  const c = window.coursesMap[courseId] || { _id: courseId, courseCode: 'CS101', courseName: 'Course Workspace' };
  selectedCourse = { _id: courseId, code: c.courseCode, name: c.courseName };

  // 1. Immediately switch UI to Workspace View
  document.getElementById('ws-course-code').textContent = c.courseCode || 'CS101';
  document.getElementById('ws-course-name').textContent = c.courseName || 'Course Workspace';
  document.getElementById('ws-enrolled-count').textContent = c.enrolledEmails
    ? `${c.enrolledEmails.length} enrolled student emails`
    : `Loading roster…`;

  hideEl('view-courses-list');
  showEl('view-course-workspace');

  // Reset workspace state
  hideEl('active-session-view');
  showEl('create-session-form');
  document.getElementById('export-csv-btn').disabled = false;
  document.getElementById('present-count').textContent = '0';
  document.getElementById('last-scan-time').textContent = '—';
  document.getElementById('attendance-list').innerHTML = `<div class="empty-state"><p>Start session to see check-ins here</p></div>`;

  // Set Add Students button handler
  const addBtn = document.getElementById('ws-add-students-btn');
  if (addBtn) {
    addBtn.onclick = () => showEnrollModal(courseId, selectedCourse.code);
  }

  // 2. Fetch full student roster in background
  try {
    const res = await fetch(`${API}/api/courses/${courseId}/students`, { headers: authHeaders() });
    if (!res.ok) return;

    const data = await res.json();
    selectedCourse.code = data.courseCode;
    selectedCourse.name = data.courseName;

    document.getElementById('ws-course-code').textContent = data.courseCode;
    document.getElementById('ws-course-name').textContent = data.courseName;
    document.getElementById('ws-enrolled-count').textContent = `${data.enrolledCount} enrolled student emails`;

    const rosterList = document.getElementById('ws-roster-list');
    if (rosterList) {
      if (!data.enrolledEmails || !data.enrolledEmails.length) {
        rosterList.innerHTML = `<div class="empty-state"><p>No student emails enrolled yet</p></div>`;
      } else {
        rosterList.innerHTML = data.enrolledEmails.map(email => `
          <div style="font-size:0.82rem;background:var(--bg-secondary);padding:0.4rem 0.6rem;border-radius:4px;border:1px solid var(--border);">
            📧 ${email}
          </div>
        `).join('');
      }
    }
  } catch (err) {
    console.error('Fetch course students error:', err);
  }
}

// ── Create Course Modal ─────────────────────────────────────────────────
function showCreateCourseModal() { showEl('course-modal'); }
function hideCreateCourseModal() { hideEl('course-modal'); setStatus('course-modal-status', ''); }

document.getElementById('create-course-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('save-course-btn');
  const code = document.getElementById('new-course-code').value.trim();
  const name = document.getElementById('new-course-name').value.trim();
  const emails = document.getElementById('new-course-emails').value.trim();

  if (!code || !name) return setStatus('course-modal-status', 'Course Code and Course Name are required');

  btn.disabled = true;
  btn.textContent = 'Creating…';

  try {
    const res = await fetch(`${API}/api/courses`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ courseCode: code, courseName: name })
    });

    const data = await res.json();
    if (!res.ok) {
      setStatus('course-modal-status', data.error || 'Failed to create course');
      btn.disabled = false;
      btn.textContent = 'Create & Enroll';
      return;
    }

    if (emails) {
      await fetch(`${API}/api/courses/${data._id}/enroll`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ emails })
      });
    }

    btn.disabled = false;
    btn.textContent = 'Create & Enroll';
    hideCreateCourseModal();
    window.coursesMap[data._id] = data;
    openCourseWorkspace(data._id);
  } catch (err) {
    setStatus('course-modal-status', 'Network error');
    btn.disabled = false;
    btn.textContent = 'Create & Enroll';
  }
});

// ── Enroll Students Modal ───────────────────────────────────────────────
function showEnrollModal(courseId, courseCode) {
  document.getElementById('enroll-course-id').value = courseId;
  document.getElementById('enroll-modal-title').textContent = `Enroll Students in ${courseCode}`;
  showEl('enroll-modal');
}
function hideEnrollModal() { hideEl('enroll-modal'); setStatus('enroll-modal-status', ''); }

document.getElementById('enroll-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const courseId = document.getElementById('enroll-course-id').value;
  const emails = document.getElementById('enroll-emails').value.trim();

  if (!emails) return setStatus('enroll-modal-status', 'Please enter student email(s)');

  try {
    const res = await fetch(`${API}/api/courses/${courseId}/enroll`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ emails })
    });

    const data = await res.json();
    if (!res.ok) return setStatus('enroll-modal-status', data.error || 'Enrollment failed');

    hideEnrollModal();
    if (selectedCourse && selectedCourse._id === courseId) {
      openCourseWorkspace(courseId);
    }
  } catch (err) {
    setStatus('enroll-modal-status', 'Network error');
  }
});

// ── Location Acquisition ────────────────────────────────────────────────
function useCurrentLocation() {
  const btn = document.getElementById('use-location-btn');
  const latInput = document.getElementById('loc-lat');
  const lngInput = document.getElementById('loc-lng');

  if (!btn || !latInput || !lngInput) return;

  btn.disabled = true;
  btn.textContent = '📍 Getting location…';
  setStatus('create-status', '');

  if (!navigator.geolocation) {
    setStatus('create-status', 'Geolocation is not supported by your browser.', 'warning');
    btn.disabled = false;
    btn.textContent = '📍 Get Location';
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => setLocationSuccess(pos, btn, latInput, lngInput),
    (err) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => setLocationSuccess(pos, btn, latInput, lngInput),
        async () => {
          const ok = await tryIpGeolocation(latInput, lngInput);
          if (ok) {
            btn.disabled = false;
            btn.textContent = '✓ Location set (IP)';
            setStatus('create-status', '📍 Location set via Wi-Fi/IP. System includes a 200m buffer for laptop vs mobile GPS variance.', 'info');
          } else {
            setStatus('create-status', 'Location permission denied. Click "Fill Demo Coords" to test.', 'warning');
            btn.disabled = false;
            btn.textContent = '📍 Get Location';
          }
        },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 0 }
      );
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
  );
}

function setLocationSuccess(pos, btn, latInput, lngInput) {
  latInput.value = pos.coords.latitude.toFixed(6);
  lngInput.value = pos.coords.longitude.toFixed(6);
  btn.disabled = false;
  btn.textContent = '✓ Location set!';
  const accStr = pos.coords.accuracy ? ` (±${Math.round(pos.coords.accuracy)}m accuracy)` : '';
  setStatus('create-status', `📍 Location set (${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)})${accStr}. 200m buffer active for laptop/phone variance.`, 'success');
  setTimeout(() => { btn.textContent = '📍 Get Location'; }, 3000);
}

async function tryIpGeolocation(latInput, lngInput) {
  try {
    const res = await fetch('https://ipapi.co/json/', { timeout: 3000 });
    if (!res.ok) return false;
    const data = await res.json();
    if (data.latitude && data.longitude) {
      latInput.value = parseFloat(data.latitude).toFixed(6);
      lngInput.value = parseFloat(data.longitude).toFixed(6);
      return true;
    }
  } catch (_) {}
  return false;
}

function fillDemoLocation() {
  const latInput = document.getElementById('loc-lat');
  const lngInput = document.getElementById('loc-lng');
  if (latInput && lngInput) {
    latInput.value = '12.9716';
    lngInput.value = '77.5946';
    setStatus('create-status', '🎯 Sample coordinates filled (12.9716, 77.5946)', 'info');
  }
}

// ── Start Session (Bound to Selected Course) ───────────────────────────
async function startSession() {
  if (!selectedCourse) return alert('Please select a course first');

  const topicInput = document.getElementById('session-topic').value.trim();
  const lat = parseFloat(document.getElementById('loc-lat').value);
  const lng = parseFloat(document.getElementById('loc-lng').value);
  const radius = parseInt(document.getElementById('radius').value);

  setStatus('create-status', '');

  const className = topicInput ? `${selectedCourse.code} — ${topicInput}` : `${selectedCourse.code} Session`;

  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return setStatus('create-status', 'Please enter valid latitude and longitude coordinates');
  }

  const btn = document.getElementById('start-session-btn');
  btn.disabled = true;
  btn.innerHTML = 'Starting…';

  try {
    const res = await fetch(`${API}/api/sessions`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        className,
        lat,
        lng,
        radiusMeters: radius,
        courseId: selectedCourse._id
      })
    });

    const data = await res.json();

    if (!res.ok) {
      if (res.status === 401) { logout(); return; }
      setStatus('create-status', data.error || 'Failed to start session');
      btn.disabled = false;
      btn.textContent = '▶ Start Attendance Session';
      return;
    }

    activeSessionId = data.sessionId;
    window.activeSessionId = data.sessionId;
    document.getElementById('active-class-name').textContent = data.className;
    document.getElementById('active-radius').textContent = data.radiusMeters;
    document.getElementById('active-start-time').textContent = new Date(data.startTime).toLocaleTimeString();
    document.getElementById('export-csv-btn').disabled = false;

    hideEl('create-session-form');
    showEl('active-session-view');

    startQRPolling();
    startAttendancePolling();
  } catch (err) {
    console.error(err);
    setStatus('create-status', 'Network error');
    btn.disabled = false;
    btn.textContent = '▶ Start Attendance Session';
  }
}

// ── End Session ─────────────────────────────────────────────────────────
async function endSession() {
  const sessionId = activeSessionId || window.activeSessionId;
  if (!sessionId) {
    setStatus('end-status', 'No active session found');
    return;
  }

  try {
    const res = await fetch(`${API}/api/sessions/${sessionId}/end`, {
      method: 'POST',
      headers: authHeaders()
    });

    const data = await res.json();

    if (!res.ok) {
      return setStatus('end-status', data.error || 'Failed to end session');
    }

    stopPolling();
    if (qrCodeInstance) {
      try { qrCodeInstance.clear(); } catch (_) {}
      qrCodeInstance = null;
    }
    const qrDisplay = document.getElementById('qr-code-display');
    if (qrDisplay) qrDisplay.innerHTML = '';

    activeSessionId = null;
    window.activeSessionId = null;

    hideEl('active-session-view');
    showEl('create-session-form');

    const startBtn = document.getElementById('start-session-btn');
    if (startBtn) {
      startBtn.disabled = false;
      startBtn.textContent = '▶ Start Attendance Session';
    }

    setStatus('create-status', '✓ Session ended successfully. All scan tokens for this session are now blocked.', 'success');

  } catch (err) {
    console.error('End session error:', err);
    setStatus('end-status', 'Network error ending session');
  }
}

// ── QR Polling ──────────────────────────────────────────────────────────
function startQRPolling() {
  fetchAndRenderQR();
  qrPollInterval = setInterval(fetchAndRenderQR, 4000);
  startCountdown();
}

async function fetchAndRenderQR() {
  if (!activeSessionId) return;

  try {
    const res = await fetch(`${API}/api/sessions/${activeSessionId}/token`);
    if (!res.ok) return;

    const data = await res.json();
    renderQR(data.qrPayload);
    resetCountdown(Math.ceil(data.windowExpiresIn / 1000));
  } catch (err) {
    console.error('QR fetch error:', err);
  }
}

function renderQR(payload) {
  lastQRPayload = payload;
  const container = document.getElementById('qr-code-display');

  if (qrCodeInstance) {
    qrCodeInstance.clear();
    qrCodeInstance.makeCode(payload);
  } else {
    container.innerHTML = '';
    qrCodeInstance = new QRCode(container, {
      text: payload,
      width: 200,
      height: 200,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  }

  updatePopoutQR(payload);
  if (document.pictureInPictureElement) drawCanvasQR();
}

// ── Countdown Timer ─────────────────────────────────────────────────────
let countdownValue = 15;

function startCountdown() {
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(tickCountdown, 1000);
}

function resetCountdown(seconds) {
  countdownValue = seconds;
  updateCountdownUI();
}

function tickCountdown() {
  if (countdownValue > 0) {
    countdownValue--;
    updateCountdownUI();
  }
}

function updateCountdownUI() {
  const el = document.getElementById('qr-countdown');
  const bar = document.getElementById('qr-progress-bar');
  if (el) el.textContent = countdownValue;
  if (bar) {
    const pct = (countdownValue / 15) * 100;
    bar.style.width = pct + '%';
  }

  if (popoutWindow && !popoutWindow.closed) {
    try {
      const popEl = popoutWindow.document.getElementById('pop-timer-text');
      const popBar = popoutWindow.document.getElementById('pop-timer-fill');
      if (popEl) popEl.textContent = countdownValue;
      if (popBar) popBar.style.width = ((countdownValue / 15) * 100) + '%';
    } catch (_) {}
  }

  if (document.pictureInPictureElement) drawCanvasQR();
}

// ── Pop-out Mini Floating QR Window & PiP Controls ──────────────────────
function openPopoutQRWindow() {
  if (!activeSessionId) return alert('No active attendance session.');

  if (popoutWindow && !popoutWindow.closed) {
    popoutWindow.focus();
    return;
  }

  const className = document.getElementById('active-class-name')?.textContent || 'Attendance QR';
  const courseCode = selectedCourse ? selectedCourse.courseCode : '';
  const width = 340;
  const height = 440;
  const left = Math.max(0, window.screen.width - width - 50);
  const top = 60;

  popoutWindow = window.open(
    '',
    'AttendX_Popout_QR',
    `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=no,status=no`
  );

  if (!popoutWindow) {
    alert('Pop-up was blocked by browser. Please allow pop-ups for AttendX to use Floating QR.');
    return;
  }

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>🎯 AttendX — Floating QR</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 1rem;
      background: #090d16; color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      text-align: center; user-select: none;
      display: flex; flex-direction: column; align-items: center; justify-content: space-between;
      height: 100vh;
    }
    .badge {
      display: inline-block; padding: 0.25rem 0.6rem;
      background: rgba(34,197,94,0.15); color: #4ade80;
      border: 1px solid rgba(34,197,94,0.3); border-radius: 4px;
      font-size: 0.72rem; font-weight: 700; letter-spacing: 0.5px;
    }
    h3 { margin: 0.35rem 0 0.1rem; font-size: 1.05rem; color: #ffffff; }
    p { margin: 0 0 0.6rem; font-size: 0.78rem; color: #94a3b8; }
    .qr-frame {
      background: #ffffff; padding: 0.75rem; border-radius: 8px;
      display: inline-block; box-shadow: 0 8px 24px rgba(0,0,0,0.6);
    }
    #popout-qr-display img, #popout-qr-display canvas { display: block; margin: 0 auto; }
    .timer-container { width: 100%; max-width: 240px; margin: 0.5rem auto 0; }
    .timer-bar-bg {
      width: 100%; height: 5px; background: rgba(255,255,255,0.1);
      border-radius: 3px; overflow: hidden;
    }
    .timer-bar-fill {
      height: 100%; background: #6366f1; transition: width 1s linear; width: 100%;
    }
    .timer-text { font-size: 0.75rem; color: #94a3b8; margin-top: 0.25rem; }
    .live-count {
      width: 100%; padding: 0.5rem;
      background: #1e293b; border: 1px solid #334155; border-radius: 6px;
      font-size: 0.85rem; font-weight: 600; color: #38bdf8;
    }
  </style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
</head>
<body>
  <div>
    <span class="badge">🔴 LIVE QR SESSION</span>
    <h3>${className}</h3>
    <p>${courseCode ? courseCode + ' — ' : ''}Scan to mark attendance</p>
  </div>

  <div class="qr-frame">
    <div id="popout-qr-display"></div>
  </div>

  <div class="timer-container">
    <div class="timer-bar-bg">
      <div class="timer-bar-fill" id="pop-timer-fill"></div>
    </div>
    <div class="timer-text">Refreshes in <strong id="pop-timer-text">15</strong>s</div>
  </div>

  <div class="live-count" id="pop-live-count">👥 ${currentLiveCount} Student${currentLiveCount === 1 ? '' : 's'} Checked In</div>
</body>
</html>`;

  popoutWindow.document.open();
  popoutWindow.document.write(html);
  popoutWindow.document.close();

  popoutQRInstance = null;
  setTimeout(() => {
    if (lastQRPayload) updatePopoutQR(lastQRPayload);
    updateCountdownUI();
  }, 350);
}

function updatePopoutQR(payload) {
  if (!popoutWindow || popoutWindow.closed) return;
  try {
    const container = popoutWindow.document.getElementById('popout-qr-display');
    if (!container) return;

    if (popoutQRInstance) {
      popoutQRInstance.clear();
      popoutQRInstance.makeCode(payload);
    } else if (popoutWindow.QRCode) {
      container.innerHTML = '';
      popoutQRInstance = new popoutWindow.QRCode(container, {
        text: payload,
        width: 180,
        height: 180,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: popoutWindow.QRCode.CorrectLevel.M
      });
    }
  } catch (err) {
    console.warn('Popout QR update error:', err);
  }
}

async function togglePictureInPictureQR() {
  if (!activeSessionId) return alert('No active attendance session.');

  if (document.pictureInPictureElement) {
    await document.exitPictureInPicture();
    return;
  }

  try {
    if (!pipCanvas) {
      pipCanvas = document.createElement('canvas');
      pipCanvas.width = 300;
      pipCanvas.height = 300;
    }

    if (!pipVideo) {
      pipVideo = document.createElement('video');
      pipVideo.muted = true;
      pipVideo.srcObject = pipCanvas.captureStream(10);
      await pipVideo.play();
    }

    drawCanvasQR();
    await pipVideo.requestPictureInPicture();
  } catch (err) {
    alert('Picture-in-Picture error: ' + (err.message || 'Not supported by browser. Use Pop-out Mini Window instead.'));
  }
}

function drawCanvasQR() {
  if (!pipCanvas) return;
  const ctx = pipCanvas.getContext('2d');
  ctx.fillStyle = '#090d16';
  ctx.fillRect(0, 0, 300, 300);

  const mainQRImg = document.querySelector('#qr-code-display img') || document.querySelector('#qr-code-display canvas');
  if (mainQRImg) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(45, 45, 210, 210);
    ctx.drawImage(mainQRImg, 50, 50, 200, 200);
  }

  ctx.fillStyle = '#4ade80';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('AttendX Live QR', 150, 25);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '12px sans-serif';
  ctx.fillText(`Refreshes in ${countdownValue}s | ${currentLiveCount} Present`, 150, 285);
}

// ── Attendance Polling & Rendering ──────────────────────────────────────
function startAttendancePolling() {
  fetchAttendance();
  attendancePollInterval = setInterval(fetchAttendance, 5000);
}

async function fetchAttendance() {
  if (!activeSessionId) return;

  try {
    const res = await fetch(`${API}/api/sessions/${activeSessionId}/attendance`, {
      headers: authHeaders()
    });
    if (!res.ok) {
      if (res.status === 401) logout();
      return;
    }

    const data = await res.json();
    renderAttendance(data.records, data.count, data.className);
  } catch (err) {
    console.error('Attendance fetch error:', err);
  }
}

function renderAttendance(records, count, className) {
  currentLiveCount = count || 0;
  document.getElementById('present-count').textContent = count;
  document.getElementById('export-csv-btn').disabled = count === 0;

  if (className) {
    document.getElementById('attendance-subtitle').textContent = `Check-ins for: ${className}`;
  }

  if (popoutWindow && !popoutWindow.closed) {
    try {
      const popCount = popoutWindow.document.getElementById('pop-live-count');
      if (popCount) popCount.textContent = `👥 ${currentLiveCount} Student${currentLiveCount === 1 ? '' : 's'} Checked In`;
    } catch (_) {}
  }

  if (!records || records.length === 0) {
    document.getElementById('last-scan-time').textContent = '—';
    document.getElementById('attendance-list').innerHTML = `<div class="empty-state"><p>Waiting for students to scan in…</p></div>`;
    return;
  }

  const latest = new Date(records[0].timestamp);
  document.getElementById('last-scan-time').textContent = latest.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  document.getElementById('attendance-list').innerHTML = records.map(r => {
    const s = r.student || {};
    const initial = s.name ? s.name[0].toUpperCase() : '?';
    const time = new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const dist = r.distanceMeters != null ? r.distanceMeters : '—';
    const roll = s.rollNumber ? `<span>Roll: ${s.rollNumber}</span>` : '';

    return `
      <div class="attendance-item">
        <div class="attendance-avatar">${initial}</div>
        <div class="attendance-info">
          <div class="attendance-name">${s.name || 'Unknown'}</div>
          <div class="attendance-meta">
            ${roll}
            <span>${s.email || ''}</span>
            <span>🕒 ${time}</span>
          </div>
        </div>
        <div class="distance-pill">📍 ${dist}m away</div>
      </div>`;
  }).join('');
}

// ── Export CSV ──────────────────────────────────────────────────────────
function exportCSV() {
  const sessionId = activeSessionId || window.activeSessionId;
  let endpoint = '';

  if (sessionId) {
    endpoint = `${API}/api/sessions/${sessionId}/export-csv`;
  } else if (selectedCourse && selectedCourse._id) {
    endpoint = `${API}/api/courses/${selectedCourse._id}/export-csv`;
  } else {
    return alert('Please select a course or start a session to export CSV');
  }

  fetch(endpoint, { headers: authHeaders() })
  .then(res => {
    if (!res.ok) throw new Error('Export failed');
    return res.blob();
  })
  .then(blob => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Attendance_Export_${selectedCourse?.code || 'Course'}_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  })
  .catch(err => alert('Failed to export CSV: ' + err.message));
}

// ── Cleanup ─────────────────────────────────────────────────────────────
function stopPolling() {
  if (qrPollInterval)        clearInterval(qrPollInterval);
  if (attendancePollInterval) clearInterval(attendancePollInterval);
  if (countdownInterval)     clearInterval(countdownInterval);
  qrPollInterval = attendancePollInterval = countdownInterval = null;

  if (popoutWindow && !popoutWindow.closed) {
    try { popoutWindow.close(); } catch (_) {}
    popoutWindow = null;
  }
  if (document.pictureInPictureElement) {
    try { document.exitPictureInPicture(); } catch (_) {}
  }
}

// Global Exports
window.showCreateCourseModal = showCreateCourseModal;
window.hideCreateCourseModal = hideCreateCourseModal;
window.showEnrollModal = showEnrollModal;
window.hideEnrollModal = hideEnrollModal;
window.showCoursesList = showCoursesList;
window.openCourseWorkspace = openCourseWorkspace;
window.openPopoutQRWindow = openPopoutQRWindow;
window.togglePictureInPictureQR = togglePictureInPictureQR;
window.exportCSV = exportCSV;
window.logout = logout;

// ── Bind Event Listeners ────────────────────────────────────────────────
function bindEventListeners() {
  document.getElementById('btn-create-course')?.addEventListener('click', showCreateCourseModal);
  document.getElementById('btn-back-courses')?.addEventListener('click', showCoursesList);
  document.getElementById('btn-close-course-modal')?.addEventListener('click', hideCreateCourseModal);
  document.getElementById('btn-cancel-course-modal')?.addEventListener('click', hideCreateCourseModal);
  document.getElementById('btn-close-enroll-modal')?.addEventListener('click', hideEnrollModal);
  document.getElementById('btn-cancel-enroll-modal')?.addEventListener('click', hideEnrollModal);
  document.getElementById('use-location-btn')?.addEventListener('click', useCurrentLocation);
  document.getElementById('demo-location-btn')?.addEventListener('click', fillDemoLocation);
  document.getElementById('start-session-btn')?.addEventListener('click', startSession);
  document.getElementById('end-session-btn')?.addEventListener('click', endSession);
  document.getElementById('btn-popout-qr')?.addEventListener('click', openPopoutQRWindow);
  document.getElementById('btn-pip-qr')?.addEventListener('click', togglePictureInPictureQR);
  document.getElementById('export-csv-btn')?.addEventListener('click', exportCSV);
  document.getElementById('logout-btn')?.addEventListener('click', logout);

  // Radius slider input listener
  const radiusInput = document.getElementById('radius');
  const radiusDisplay = document.getElementById('radius-display');
  if (radiusInput && radiusDisplay) {
    radiusInput.addEventListener('input', (e) => {
      radiusDisplay.textContent = e.target.value;
    });
  }

  // Radius quick-preset buttons (50m, 100m, 200m, 500m)
  document.querySelectorAll('.btn-radius-preset').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const r = e.target.getAttribute('data-radius');
      if (radiusInput) radiusInput.value = r;
      if (radiusDisplay) radiusDisplay.textContent = r;
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  bindEventListeners();
  loadCourses();
});

if (document.readyState !== 'loading') {
  bindEventListeners();
  loadCourses();
}
