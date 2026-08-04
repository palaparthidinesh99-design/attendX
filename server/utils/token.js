const crypto = require('crypto');

/**
 * Returns the current 15-second time window bucket since epoch.
 * Every 15 seconds this returns a new integer.
 */
function currentTimeWindow() {
  return Math.floor(Date.now() / 15000);
}

/**
 * Generates a short HMAC-SHA256 token for the given session + time window.
 * Token is deterministic — no DB state needed to regenerate it.
 *
 * @param {string} sessionId  - MongoDB ObjectId as string
 * @param {string} secret     - Per-session random secret
 * @param {number} timeWindow - Optional override; defaults to current window
 * @returns {string} 16-char hex token
 */
function generateToken(sessionId, secret, timeWindow = currentTimeWindow()) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${sessionId}:${timeWindow}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Verifies a submitted token against the current and previous time window
 * (gives ~30s of tolerance for network latency / clock skew).
 *
 * @param {string} sessionId      - MongoDB ObjectId as string
 * @param {string} secret         - Per-session random secret
 * @param {string} submittedToken - Token from the student's scanned QR
 * @returns {boolean}
 */
function verifyToken(sessionId, secret, submittedToken) {
  const now = currentTimeWindow();
  // Accept current window and previous window (covers scan-in-flight + clock skew)
  for (const window of [now, now - 1]) {
    if (generateToken(sessionId, secret, window) === submittedToken) return true;
  }
  return false;
}

module.exports = { generateToken, verifyToken, currentTimeWindow };
