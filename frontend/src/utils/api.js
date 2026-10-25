// Central API utility

export const API_BASE = (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1')
  ? 'https://attendx-qnqb.onrender.com'
  : '';

export function getToken() {
  return localStorage.getItem('attendx_token');
}

export function getUser() {
  try {
    return JSON.parse(localStorage.getItem('attendx_user') || 'null');
  } catch (_) {
    return null;
  }
}

export function saveAuth(token, user) {
  localStorage.setItem('attendx_token', token);
  localStorage.setItem('attendx_user', JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem('attendx_token');
  localStorage.removeItem('attendx_user');
}

export async function apiFetch(endpoint, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers
  };

  const url = `${API_BASE}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers
  });

  if (response.status === 401) {
    clearAuth();
    if (!window.location.pathname.includes('/auth') && window.location.pathname !== '/') {
      window.location.href = '/';
    }
  }

  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }
    return data;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Request failed');
  }

  return response;
}
