const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} = require('@simplewebauthn/server');
const { query } = require('../config/db');

function getRPInfo(req) {
  const originHeader = req.get('origin') || req.get('referer');
  if (originHeader) {
    try {
      const u = new URL(originHeader);
      return {
        origin: u.origin,
        rpID: u.hostname
      };
    } catch (_) {}
  }
  const host = req.get('host') || req.hostname;
  return {
    origin: `${req.protocol}://${host}`,
    rpID: req.hostname === 'localhost' ? 'localhost' : req.hostname
  };
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET || 'dev_fallback_secret_key_12345',
    { expiresIn: '7d' }
  );
}

// POST /api/auth/register
async function register(req, res, next) {
  try {
    const { name, email, password, role, rollNumber } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'Name, email, password and role are required' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanName = String(name).trim();
    const cleanPassword = String(password).trim();
    const cleanRole = String(role).trim().toLowerCase();

    if (!['teacher', 'student', 'admin'].includes(cleanRole)) {
      return res.status(400).json({ error: 'Role must be student, teacher, or admin' });
    }

    if (cleanPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existingUser = await query('SELECT id FROM users WHERE LOWER(email) = $1', [cleanEmail]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email address already exists' });
    }

    const passwordHash = await bcrypt.hash(cleanPassword, 12);

    const result = await query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role, created_at`,
      [cleanName, cleanEmail, passwordHash, cleanRole]
    );

    const user = result.rows[0];
    const token = signToken(user);

    res.status(201).json({
      token,
      user: {
        id: user.id,
        _id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        rollNumber: rollNumber || undefined
      }
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An account with this email address already exists' });
    }
    next(err);
  }
}

// POST /api/auth/login
async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanPassword = String(password).trim();

    const result = await query(
      'SELECT id, name, email, password_hash, role FROM users WHERE LOWER(email) = $1',
      [cleanEmail]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'No account found with this email address' });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(cleanPassword, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    const token = signToken(user);

    res.json({
      token,
      user: {
        id: user.id,
        _id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/auth/webauthn-status — Check passkey registration status
async function getWebAuthnStatus(req, res, next) {
  try {
    const credRes = await query(
      'SELECT id, credential_id, created_at FROM webauthn_credentials WHERE user_id = $1',
      [req.user.id]
    );
    const count = credRes.rows.length;
    res.json({ isRegistered: count > 0, deviceCount: count });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/webauthn/register-options — Generate Registration Challenge
async function getRegisterOptions(req, res, next) {
  try {
    const userRes = await query('SELECT id, name, email FROM users WHERE id = $1', [req.user.id]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const user = userRes.rows[0];

    const credsRes = await query('SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = $1', [user.id]);
    const { origin, rpID } = getRPInfo(req);

    const options = await generateRegistrationOptions({
      rpName: 'AttendX Biometric Portal',
      rpID,
      userID: new Uint8Array(Buffer.from(user.id.toString())),
      userName: user.email,
      userDisplayName: user.name,
      attestationType: 'none',
      authenticatorSelection: {
        userVerification: 'preferred',
        residentKey: 'discouraged'
      },
      excludeCredentials: credsRes.rows.map(c => ({
        id: c.credential_id,
        transports: typeof c.transports === 'string' ? JSON.parse(c.transports) : (c.transports || ['internal'])
      }))
    });

    await query('UPDATE users SET current_challenge = $1 WHERE id = $2', [options.challenge, user.id]);
    res.json(options);
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/webauthn/register-verify — Verify Hardware Attestation Response
async function verifyRegister(req, res, next) {
  try {
    const { body } = req;
    const userRes = await query('SELECT id, current_challenge FROM users WHERE id = $1', [req.user.id]);
    if (userRes.rows.length === 0 || !userRes.rows[0].current_challenge) {
      return res.status(400).json({ error: 'Registration challenge expired or missing' });
    }
    const user = userRes.rows[0];
    const { origin, rpID } = getRPInfo(req);

    const verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: user.current_challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false
    });

    if (verification.verified && verification.registrationInfo) {
      const { credential } = verification.registrationInfo;
      const credentialID = credential.id;
      const publicKey = Buffer.from(credential.publicKey).toString('base64url');
      const counter = credential.counter || 0;
      const transports = JSON.stringify(body.response?.transports || ['internal']);

      await query(
        `INSERT INTO webauthn_credentials (user_id, credential_id, public_key, counter, transports)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (credential_id) DO UPDATE SET public_key = $3, counter = $4, transports = $5`,
        [user.id, credentialID, publicKey, counter, transports]
      );

      await query('UPDATE users SET current_challenge = NULL WHERE id = $1', [user.id]);
      return res.json({ verified: true, message: 'Hardware Touch ID / Fingerprint registered successfully!' });
    }

    res.status(400).json({ verified: false, error: 'Biometric registration verification failed' });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/webauthn/authenticate-options — Generate Authentication Challenge
async function getAuthOptions(req, res, next) {
  try {
    const userRes = await query('SELECT id FROM users WHERE id = $1', [req.user.id]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    const credsRes = await query('SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = $1', [req.user.id]);
    if (credsRes.rows.length === 0) {
      return res.status(403).json({ error: 'No registered biometric passkey found. Please register hardware Touch ID / Fingerprint first.' });
    }

    const { origin, rpID } = getRPInfo(req);
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'preferred',
      allowCredentials: credsRes.rows.map(c => ({
        id: c.credential_id,
        transports: typeof c.transports === 'string' ? JSON.parse(c.transports) : (c.transports || ['internal'])
      }))
    });

    await query('UPDATE users SET current_challenge = $1 WHERE id = $2', [options.challenge, req.user.id]);
    res.json(options);
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/webauthn/authenticate-verify — Verify Hardware Signature
async function verifyAuth(req, res, next) {
  try {
    const { body } = req;
    const userRes = await query('SELECT id, current_challenge FROM users WHERE id = $1', [req.user.id]);
    if (userRes.rows.length === 0 || !userRes.rows[0].current_challenge) {
      return res.status(400).json({ error: 'Authentication challenge expired or missing' });
    }

    const credRes = await query(
      'SELECT credential_id, public_key, counter FROM webauthn_credentials WHERE user_id = $1 AND credential_id = $2',
      [req.user.id, body.id]
    );

    if (credRes.rows.length === 0) {
      return res.status(400).json({ error: 'Passkey device credential not registered for this account' });
    }

    const cred = credRes.rows[0];
    const { origin, rpID } = getRPInfo(req);

    const verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: userRes.rows[0].current_challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: cred.credential_id,
        publicKey: Buffer.from(cred.public_key, 'base64url'),
        counter: parseInt(cred.counter, 10) || 0
      },
      requireUserVerification: false
    });

    if (verification.verified) {
      const newCounter = verification.authenticationInfo?.newCounter || cred.counter;
      await query('UPDATE webauthn_credentials SET counter = $1 WHERE credential_id = $2', [newCounter, cred.credential_id]);
      await query('UPDATE users SET current_challenge = NULL WHERE id = $1', [req.user.id]);
      return res.json({ verified: true, message: 'Hardware Touch ID / Fingerprint verified successfully!' });
    }

    res.status(400).json({ verified: false, error: 'Biometric verification failed' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  register,
  login,
  getWebAuthnStatus,
  getRegisterOptions,
  verifyRegister,
  getAuthOptions,
  verifyAuth
};
