/* simple auth.js — register & login handler */

const API = (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1')
  ? 'https://attendx-qnqb.onrender.com'
  : '';

function getToken() { return localStorage.getItem('attendx_token'); }
function getUser()  { return JSON.parse(localStorage.getItem('attendx_user') || 'null'); }

function saveAuth(token, user) {
  localStorage.setItem('attendx_token', token);
  localStorage.setItem('attendx_user', JSON.stringify(user));
}

function redirectByRole(role) {
  window.location.href = role === 'teacher' ? '/teacher.html' : '/student.html';
}

// Redirect if already logged in
(function checkLoggedIn() {
  const token = getToken();
  const user = getUser();
  if (token && user) {
    redirectByRole(user.role);
  }
})();

// Tab Switcher
function switchTab(tab) {
  const loginForm    = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const tabLogin     = document.getElementById('tab-login');
  const tabRegister  = document.getElementById('tab-register');

  document.getElementById('login-status').innerHTML = '';
  document.getElementById('register-status').innerHTML = '';

  if (tab === 'login') {
    loginForm?.classList.remove('hidden');
    registerForm?.classList.add('hidden');
    tabLogin?.classList.add('active');
    tabRegister?.classList.remove('active');
  } else {
    loginForm?.classList.add('hidden');
    registerForm?.classList.remove('hidden');
    tabLogin?.classList.remove('active');
    tabRegister?.classList.add('active');
  }
}

// Helper for status alert
function setStatus(id, msg, isSuccess = false) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!msg) { el.innerHTML = ''; return; }
  const cls = isSuccess ? 'alert-success' : 'alert-error';
  el.innerHTML = `<div class="alert ${cls} mt-1">${msg}</div>`;
}

// Login
document.getElementById('login-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value.trim();
  const btn = document.getElementById('login-btn');

  setStatus('login-status', '');

  if (!email || !password) {
    return setStatus('login-status', 'Please enter email and password');
  }

  btn.disabled = true;
  btn.textContent = 'Signing in…';

  try {
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();

    if (!res.ok) {
      setStatus('login-status', data.error || 'Login failed');
      btn.disabled = false;
      btn.textContent = 'Sign In';
      return;
    }

    saveAuth(data.token, data.user);
    redirectByRole(data.user.role);
  } catch (err) {
    setStatus('login-status', 'Server connection error');
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
});

// Register
document.getElementById('register-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('reg-name').value.trim();
  const role = document.getElementById('reg-role').value;
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value.trim();
  const rollNumber = document.getElementById('reg-roll')?.value.trim();
  const btn = document.getElementById('register-btn');

  setStatus('register-status', '');

  if (!name || !email || !password) {
    return setStatus('register-status', 'Please fill out all required fields');
  }
  if (password.length < 6) {
    return setStatus('register-status', 'Password must be at least 6 characters');
  }

  btn.disabled = true;
  btn.textContent = 'Creating account…';

  try {
    const body = { name, email, password, role };
    if (role === 'student' && rollNumber) body.rollNumber = rollNumber;

    const res = await fetch(`${API}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await res.json();

    if (!res.ok) {
      if (res.status === 409) {
        // Email already registered — switch to Sign In tab and pre-fill email!
        switchTab('login');
        document.getElementById('login-email').value = email;
        setStatus('login-status', 'Account already exists. Please sign in below.', true);
      } else {
        setStatus('register-status', data.error || 'Registration failed');
      }
      btn.disabled = false;
      btn.textContent = 'Create Account';
      return;
    }

    saveAuth(data.token, data.user);
    redirectByRole(data.user.role);
  } catch (err) {
    setStatus('register-status', 'Server connection error');
    btn.disabled = false;
    btn.textContent = 'Create Account';
  }
});

// Tab Switch listeners
document.getElementById('tab-login')?.addEventListener('click', () => switchTab('login'));
document.getElementById('tab-register')?.addEventListener('click', () => switchTab('register'));
