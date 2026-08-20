const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { authenticate, requireRole } = require('../middleware/auth');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} = require('@simplewebauthn/server');

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET || 'fallback_secret',
    { expiresIn: '7d' }
  );
}

const getRPID = (req) => {
  const origin = req.get('origin') || req.get('referer');
  if (origin) {
    try {
      const url = new URL(origin);
      return url.hostname;
    } catch (e) {}
  }
  const host = req.get('host') || 'localhost';
  return host.split(':')[0];
};

const getOrigin = (req) => {
  const origin = req.get('origin');
  if (origin) return origin;
  const referer = req.get('referer');
  if (referer) {
    try {
      const url = new URL(referer);
      return url.origin;
    } catch (e) {}
  }
  const protocol = req.protocol || 'https';
  const host = req.get('host') || 'localhost:3000';
  return `${protocol}://${host}`;
};

// POST /api/auth/register
router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password, role, rollNumber } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'Name, email, password and role are required' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanName = String(name).trim();
    const cleanPassword = String(password).trim();

    if (!['teacher', 'student'].includes(role)) {
      return res.status(400).json({ error: 'Role must be teacher or student' });
    }

    if (cleanPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = await User.findOne({ email: cleanEmail });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email address already exists' });
    }

    const user = await User.create({
      name: cleanName,
      email: cleanEmail,
      password: cleanPassword,
      role,
      rollNumber: role === 'student' && rollNumber ? String(rollNumber).trim() : undefined
    });

    const token = signToken(user);

    res.status(201).json({
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role, rollNumber: user.rollNumber }
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'An account with this email address already exists' });
    }
    next(err);
  }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanPassword = String(password).trim();

    const user = await User.findOne({ email: cleanEmail });
    if (!user) {
      return res.status(401).json({ error: 'No account found with this email address' });
    }

    const isMatch = await user.comparePassword(cleanPassword);
    if (!isMatch) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    const token = signToken(user);

    res.json({
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role, rollNumber: user.rollNumber }
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/webauthn-status — Check if student has registered a Passkey
router.get('/webauthn-status', authenticate, requireRole('student'), async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const isRegistered = Array.isArray(user.webauthnDevices) && user.webauthnDevices.length > 0;
    res.json({ isRegistered, deviceCount: user.webauthnDevices ? user.webauthnDevices.length : 0 });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/webauthn/register-options — Generate Registration Challenge
router.post('/webauthn/register-options', authenticate, requireRole('student'), async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const rpID = getRPID(req);
    const options = await generateRegistrationOptions({
      rpName: 'AttendX Proxy System',
      rpID,
      userID: new TextEncoder().encode(user._id.toString()),
      userName: user.email,
      userDisplayName: user.name,
      authenticatorSelection: {
        userVerification: 'preferred',
        residentKey: 'discouraged'
      },
      attestationType: 'none',
      excludeCredentials: (user.webauthnDevices || []).map(dev => ({
        id: dev.credentialID,
        transports: dev.transports
      }))
    });

    user.currentChallenge = options.challenge;
    await user.save();

    res.json(options);
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/webauthn/register-verify — Verify Registration Response
router.post('/webauthn/register-verify', authenticate, requireRole('student'), async (req, res, next) => {
  try {
    const { body } = req;
    const user = await User.findById(req.user._id);
    if (!user || !user.currentChallenge) {
      return res.status(400).json({ error: 'Registration challenge expired or missing' });
    }

    const rpID = getRPID(req);
    const origin = getOrigin(req);

    const verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: user.currentChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID
    });

    if (verification.verified && verification.registrationInfo) {
      const { credential } = verification.registrationInfo;
      user.webauthnDevices = user.webauthnDevices || [];
      user.webauthnDevices.push({
        credentialID: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64url'),
        counter: credential.counter,
        transports: body.response.transports || ['internal']
      });
      user.currentChallenge = null;
      await user.save();

      return res.json({ verified: true, message: 'Hardware Passkey (TouchID / FaceID) registered successfully!' });
    }

    res.status(400).json({ verified: false, error: 'Passkey registration verification failed' });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/webauthn/authenticate-options — Generate Authentication Challenge
router.post('/webauthn/authenticate-options', authenticate, requireRole('student'), async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user || !user.webauthnDevices || user.webauthnDevices.length === 0) {
      return res.status(403).json({ error: 'No registered Passkey found. Please register hardware TouchID/FaceID first.' });
    }

    const rpID = getRPID(req);
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'preferred',
      allowCredentials: user.webauthnDevices.map(dev => ({
        id: dev.credentialID,
        transports: dev.transports
      }))
    });

    user.currentChallenge = options.challenge;
    await user.save();

    res.json(options);
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/webauthn/authenticate-verify — Verify Hardware Signature
router.post('/webauthn/authenticate-verify', authenticate, requireRole('student'), async (req, res, next) => {
  try {
    const { body } = req;
    const user = await User.findById(req.user._id);
    if (!user || !user.currentChallenge) {
      return res.status(400).json({ error: 'Authentication challenge expired or missing' });
    }

    const dev = (user.webauthnDevices || []).find(d => d.credentialID === body.id);
    if (!dev) {
      return res.status(400).json({ error: 'Passkey device credential not registered for this account' });
    }

    const rpID = getRPID(req);
    const origin = getOrigin(req);

    const verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: user.currentChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: dev.credentialID,
        publicKey: Buffer.from(dev.publicKey, 'base64url'),
        counter: dev.counter
      }
    });

    if (verification.verified) {
      dev.counter = verification.authenticationInfo.newCounter;
      user.currentChallenge = null;
      await user.save();
      return res.json({ verified: true, message: 'Hardware Passkey (TouchID / FaceID) verified successfully' });
    }

    res.status(403).json({ verified: false, error: 'Hardware biometric authentication failed' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
