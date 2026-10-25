const express = require('express');
const {
  register,
  login,
  getWebAuthnStatus,
  getRegisterOptions,
  verifyRegister,
  getAuthOptions,
  verifyAuth
} = require('../controllers/authController');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.get('/webauthn-status', authenticate, getWebAuthnStatus);
router.post('/webauthn/register-options', authenticate, getRegisterOptions);
router.post('/webauthn/register-verify', authenticate, verifyRegister);
router.post('/webauthn/authenticate-options', authenticate, getAuthOptions);
router.post('/webauthn/authenticate-verify', authenticate, verifyAuth);

module.exports = router;
