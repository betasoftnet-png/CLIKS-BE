const express = require('express');
const router = express.Router();
const { authLimiter } = require('../middleware/rateLimiter');
const validate = require('../middleware/zodValidate');
const asyncHandler = require('../utils/asyncHandler');
const { registerSchema, loginSchema, register, login, refresh, logout, logoutAll } = require('../controllers/authController');

// POST /auth/register      — Register a new user account
router.post('/register', authLimiter, validate(registerSchema), asyncHandler(register));

// POST /auth/login         — Login with email/username + password
router.post('/login', authLimiter, validate(loginSchema), asyncHandler(login));

// POST /auth/refresh       — Refresh access token using a refresh token
router.post('/refresh', authLimiter, asyncHandler(refresh));

// POST /auth/logout        — Logout (revoke current refresh token)
router.post('/logout', asyncHandler(logout));

// POST /auth/logout-all    — Logout from all devices (revoke all tokens)
router.post('/logout-all', asyncHandler(logoutAll));

module.exports = router;
