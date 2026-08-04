/* server/utils/token.test.js — unit tests for HMAC token logic */

const { generateToken, verifyToken, currentTimeWindow } = require('./token');

let passed = 0;
let failed = 0;

function assert(description, condition) {
  if (condition) {
    console.log(`  ✅ ${description}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${description}`);
    failed++;
  }
}

console.log('\n🔑 Token Utility Tests\n');

const sessionId = '64c1a2b3d4e5f6g7h8i9j0k1';
const secret    = 'super-secret-test-key-1234567890';
const now       = currentTimeWindow();

// 1. Basic generation
const token = generateToken(sessionId, secret, now);
assert('generates a 16-char hex token', typeof token === 'string' && token.length === 16);
assert('token contains only hex chars', /^[0-9a-f]+$/.test(token));

// 2. Deterministic — same inputs → same output
const token2 = generateToken(sessionId, secret, now);
assert('same inputs produce same token (deterministic)', token === token2);

// 3. Different inputs → different token
const tokenDiff = generateToken(sessionId, secret, now + 1);
assert('different time window produces different token', token !== tokenDiff);

const tokenDiffSecret = generateToken(sessionId, 'other-secret', now);
assert('different secret produces different token', token !== tokenDiffSecret);

// 4. Verification — current window accepted
assert('verifyToken accepts current window', verifyToken(sessionId, secret, token));

// 5. Verification — previous window accepted (scan-in-flight tolerance)
const prevToken = generateToken(sessionId, secret, now - 1);
assert('verifyToken accepts previous window (clock skew tolerance)', verifyToken(sessionId, secret, prevToken));

// 6. Verification — two windows ago rejected
const oldToken = generateToken(sessionId, secret, now - 2);
assert('verifyToken rejects token 2 windows old', !verifyToken(sessionId, secret, oldToken));

// 7. Verification — wrong secret rejected
const wrongSecretToken = generateToken(sessionId, 'wrong-secret', now);
assert('verifyToken rejects token from wrong secret', !verifyToken(sessionId, secret, wrongSecretToken));

// 8. Verification — tampered token rejected
const tampered = token.slice(0, 15) + 'x';
assert('verifyToken rejects tampered token', !verifyToken(sessionId, secret, tampered));

// 9. Empty / invalid inputs
assert('verifyToken handles empty token string', !verifyToken(sessionId, secret, ''));
assert('verifyToken handles null gracefully', !verifyToken(sessionId, secret, null));

// ── Summary ─────────────────────────────────────────────────────────────
console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
