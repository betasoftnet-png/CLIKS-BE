const express = require('express');
const router = express.Router();
const { authLimiter } = require('../middleware/rateLimiter');
const asyncHandler = require('../utils/asyncHandler');
const { ssoLogin, refresh, logout, logoutAll } = require('../controllers/authController');

// POST /auth/sso           — SSO Login using BNX Token
router.post('/sso', authLimiter, asyncHandler(ssoLogin));

// POST /auth/refresh       — Refresh access token using a refresh token
router.post('/refresh', authLimiter, asyncHandler(refresh));

// POST /auth/logout        — Logout (revoke current refresh token)
router.post('/logout', asyncHandler(logout));

// POST /auth/logout-all    — Logout from all devices (revoke all tokens)
router.post('/logout-all', asyncHandler(logoutAll));

module.exports = router;
