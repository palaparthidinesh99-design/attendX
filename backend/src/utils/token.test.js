const assert = require('assert');
const { generateToken, verifyToken, currentTimeWindow } = require('./token');

console.log('🧪 Testing HMAC Token Generator...');

const dummySessionId = 'c02fb3b3-8dc9-4a0b-8d19-d9d1be6a241e';
const dummySecret = 'super_secret_test_key_1234567890';

const token1 = generateToken(dummySessionId, dummySecret);
assert.strictEqual(typeof token1, 'string');
assert.strictEqual(token1.length, 16);
assert.strictEqual(verifyToken(dummySessionId, dummySecret, token1), true);

// Verify with wrong secret fails
assert.strictEqual(verifyToken(dummySessionId, 'wrong_secret', token1), false);

// Verify with wrong token fails
assert.strictEqual(verifyToken(dummySessionId, dummySecret, 'invalid123456789'), false);

console.log('✅ Token tests passed');
