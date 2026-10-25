import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, saveAuth, getUser, getToken } from '../utils/api';
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

  // If already logged in, redirect by role
  useEffect(() => {
    const user = getUser();
    const token = getToken();
    if (user && token) {
      navigate(String(user.role).toLowerCase() === 'teacher' ? '/teacher' : '/student');
    }
  }, [navigate]);

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

        {error && <div className="alert alert-error">{error}</div>}

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
        </div>
      </div>
    </div>
  );
}
