import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, saveAuth, getUser, getToken, getApiBase, setCustomApiBase, checkBackendHealth } from '../utils/api';
import '../styles/AuthPage.css';

export default function AuthPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('login'); // 'login' | 'register'
  const [role, setRole] = useState('student'); // 'student' | 'teacher'
  
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rollNumber, setRollNumber] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Backend configuration state
  const [showConfig, setShowConfig] = useState(false);
  const [customUrl, setCustomUrl] = useState(getApiBase());
  const [healthStatus, setHealthStatus] = useState(null); // 'checking' | 'connected' | 'disconnected'

  // If already logged in, redirect by role
  useEffect(() => {
    const user = getUser();
    const token = getToken();
    if (user && token) {
      navigate(String(user.role).toLowerCase() === 'teacher' ? '/teacher' : '/student');
    }
  }, [navigate]);

  const testHealth = async () => {
    setHealthStatus('checking');
    const ok = await checkBackendHealth();
    setHealthStatus(ok ? 'connected' : 'disconnected');
  };

  const handleSaveConfig = (e) => {
    e.preventDefault();
    setCustomApiBase(customUrl);
    testHealth();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (tab === 'login') {
        const data = await apiFetch('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password })
        });
        saveAuth(data.token, data.user);
        navigate(String(data.user.role).toLowerCase() === 'teacher' ? '/teacher' : '/student');
      } else {
        const payload = {
          name,
          email,
          password,
          role,
          ...(role === 'student' && rollNumber ? { rollNumber } : {})
        };
        const data = await apiFetch('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        saveAuth(data.token, data.user);
        navigate(String(data.user.role).toLowerCase() === 'teacher' ? '/teacher' : '/student');
      }
    } catch (err) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const currentBackend = getApiBase() || '(Same Origin / Render Web Service)';

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">🎯</div>
        <h1 className="auth-title">Welcome to AttendX</h1>
        <p className="auth-subtitle">Secure Anti-Proxy Attendance Management</p>

        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab ${tab === 'login' ? 'active' : ''}`}
            onClick={() => { setTab('login'); setError(''); }}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`auth-tab ${tab === 'register' ? 'active' : ''}`}
            onClick={() => { setTab('register'); setError(''); }}
          >
            Create Account
          </button>
        </div>

        {error && (
          <div className="alert alert-error" style={{ textAlign: 'left', fontSize: '0.82rem' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {tab === 'register' && (
            <>
              <div className="form-group">
                <label className="form-label">I am a</label>
                <div className="role-selector">
                  <div
                    className={`role-card ${role === 'student' ? 'active' : ''}`}
                    onClick={() => setRole('student')}
                  >
                    🎓 Student
                  </div>
                  <div
                    className={`role-card ${role === 'teacher' ? 'active' : ''}`}
                    onClick={() => setRole('teacher')}
                  >
                    🧑‍🏫 Teacher
                  </div>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Alan Turing"
                  className="form-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              {role === 'student' && (
                <div className="form-group">
                  <label className="form-label">Roll Number (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. 2024CS101"
                    className="form-input"
                    value={rollNumber}
                    onChange={(e) => setRollNumber(e.target.value)}
                  />
                </div>
              )}
            </>
          )}

          <div className="form-group">
            <label className="form-label">Email Address</label>
            <input
              type="email"
              required
              placeholder="name@university.edu"
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              type="password"
              required
              placeholder="••••••••"
              minLength={6}
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-full"
            style={{ marginTop: '0.75rem', padding: '0.8rem' }}
            disabled={loading}
          >
            {loading ? 'Please wait…' : (tab === 'login' ? 'Sign In' : 'Create Account')}
          </button>
        </form>

        <div className="auth-footer">
          {tab === 'login' ? (
            <p>Don't have an account? <a href="#signup" onClick={(e) => { e.preventDefault(); setTab('register'); setError(''); }}>Sign up</a></p>
          ) : (
            <p>Already have an account? <a href="#signin" onClick={(e) => { e.preventDefault(); setTab('login'); setError(''); }}>Sign in</a></p>
          )}

          {/* Backend Connection Config Option */}
          <div className="server-config-section">
            <button
              type="button"
              className="server-config-toggle"
              onClick={() => setShowConfig(!showConfig)}
            >
              ⚙️ Server: <span className="server-url-badge">{currentBackend}</span>
            </button>

            {showConfig && (
              <div className="server-config-box">
                <p className="server-config-help">
                  Paste your Render backend Web Service URL (e.g. <code>https://attendx-backend-xxxx.onrender.com</code>):
                </p>
                <div className="server-input-row">
                  <input
                    type="url"
                    placeholder="https://your-backend.onrender.com"
                    value={customUrl}
                    onChange={(e) => setCustomUrl(e.target.value)}
                    className="form-input form-input-sm"
                  />
                  <button type="button" onClick={handleSaveConfig} className="btn btn-sm btn-primary">
                    Save
                  </button>
                  <button type="button" onClick={testHealth} className="btn btn-sm btn-outline">
                    Test
                  </button>
                </div>
                {healthStatus === 'checking' && <p className="status-text checking">Checking connection…</p>}
                {healthStatus === 'connected' && <p className="status-text connected">✅ Connected to backend!</p>}
                {healthStatus === 'disconnected' && <p className="status-text disconnected">❌ Unreachable (Render may be starting up)</p>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
