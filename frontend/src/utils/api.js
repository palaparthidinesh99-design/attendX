// Central API utility for AttendX

export function formatUrl(raw) {
  if (!raw || !raw.trim()) return '';
  let url = raw.trim();

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }

  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
      parsed.hostname = `${parsed.hostname}.onrender.com`;
    }
    return parsed.origin;
  } catch (_) {
    return url.replace(/\/+$/, '');
  }
}

export function getApiBase() {
  // 1. Manual user override stored in localStorage
  const custom = localStorage.getItem('attendx_custom_api_url');
  if (custom && custom.trim()) {
    return formatUrl(custom);
  }

  // 2. Injected Vite environment variable from Render Blueprint
  const envUrl = import.meta.env.VITE_API_BASE_URL;
  if (envUrl && envUrl.trim()) {
    return formatUrl(envUrl);
  }

  // 3. Localhost dev environment uses Vite dev proxy
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return '';
    }
    // 4. Default for Render deployment
    if (host.includes('onrender.com')) {
      return 'https://attendx-backend-yo7n.onrender.com';
    }
  }

  return '';
}

export function setCustomApiBase(url) {
  if (!url || !url.trim()) {
    localStorage.removeItem('attendx_custom_api_url');
  } else {
    localStorage.setItem('attendx_custom_api_url', formatUrl(url));
  }
}

export const API_BASE = getApiBase();

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

export async function checkBackendHealth() {
  const base = getApiBase();
  const testUrl = base ? `${base}/health` : '/health';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(testUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    return res.ok;
  } catch (_) {
    clearTimeout(timeoutId);
    return false;
  }
}

export async function apiFetch(endpoint, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers
  };

  const base = getApiBase();
  const path = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
  const url = base ? `${base}${path}` : path;

  // 20 second timeout for Render free tier spinning up
  const controller = new AbortController();
  const timeoutMs = options.timeout || 20000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(
        `Backend server request timed out (${timeoutMs / 1000}s). If your Render backend is on the free tier, it may be waking up from sleep. Please try again in 10-15 seconds.`
      );
    }
    throw new Error(
      `Cannot connect to backend server at ${base || window.location.origin}. Please verify your Backend URL.`
    );
  } finally {
    clearTimeout(timeoutId);
  }

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
    throw new Error(text || `Request failed with status ${response.status}`);
  }

  return response;
}
