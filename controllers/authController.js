// const bcrypt = require('bcryptjs');
// const { z } = require('zod');

const db = require('../db/connection');
const { sendSuccess } = require('../utils/response');
const AppError = require('../utils/AppError');
const TokenService = require('../utils/tokenService');

// ── Zod Schemas ───────────────────────────────────────────────────────────────
// ── SSO Login Gateway ────────────────────────────────────────────────────────
const ssoLogin = async (req, res) => {
  const { bnxToken, appType } = req.body;
  if (!bnxToken) throw new AppError('BNX Token is required', 400, 'BAD_REQUEST');

  // Verify token with BNX Mail API
  let bnxProfile;
  try {
    const bnxRes = await fetch('https://api.bnxmail.com/api/users/me', {
      headers: { 'Authorization': `Bearer ${bnxToken}` }
    });
    const bnxData = await bnxRes.json();
    
    if (!bnxRes.ok || !bnxData.success) {
      throw new Error('Invalid BNX Token');
    }
    bnxProfile = bnxData.data;
  } catch (err) {
    throw new AppError('Failed to verify SSO token: ' + err.message, 401, 'UNAUTHORIZED');
  }

  const { email, name: _name, accountType } = bnxProfile;

  // Enforce Business Account for Business App
  if (appType === 'BUSINESS' && accountType !== 'BUSINESS') {
    throw new AppError('Access denied. This application requires a BNX Business account.', 403, 'FORBIDDEN');
  }
  // If the user's name is multiple words, extract a username if missing
  const username = email.split('@')[0];

  // Check if user exists
  let user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);

  if (!user) {
    // Auto-register user
    const now = new Date().toISOString();
    const role = accountType === 'BUSINESS' ? 'business' : 'user';
    const hash = 'sso-managed'; // No local password

    // Try to use email prefix as username, fallback to full email if prefix is taken
    let finalUsername = username;
    const existingByUsername = await db.prepare('SELECT id FROM users WHERE username = ?').get(finalUsername);
    if (existingByUsername) {
      finalUsername = email; // Fallback to full email as username
    }

    try {
      const info = await db.prepare(
        'INSERT INTO users (username, email, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(finalUsername, email, hash, role, now, now);

      user = await db.prepare('SELECT id, username, email, role, created_at FROM users WHERE id = ?').get(info.lastInsertRowid || info.id || info[0]?.id);
    } catch (dbErr) {
      // Final safety fallback if even full email as username somehow fails (e.g. race condition)
      if (dbErr.message.includes('UNIQUE constraint failed: users.username') || dbErr.message.includes('duplicate key value')) {
        finalUsername = `${username}_${Math.floor(Math.random() * 10000)}`;
        const info = await db.prepare(
          'INSERT INTO users (username, email, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(finalUsername, email, hash, role, now, now);
        user = await db.prepare('SELECT id, username, email, role, created_at FROM users WHERE id = ?').get(info.lastInsertRowid || info.id || info[0]?.id);
      } else {
        throw dbErr;
      }
    }
  }

  const { accessToken, refreshToken } = await TokenService.issueEnhancedTokens(user);

  const safeUser = { id: user.id, username: user.username, email: user.email, role: user.role, created_at: user.created_at };
  return sendSuccess(res, { accessToken, refreshToken, user: safeUser }, 'SSO login successful', 200);
};

// ── POST /auth/refresh ───────────────────────────────────────────────────────
const refresh = async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) throw new AppError('Refresh token required', 400, 'BAD_REQUEST');

  try {
    const tokens = await TokenService.rotateRefreshToken(refreshToken);
    return sendSuccess(res, tokens, 'Token refreshed successfully');
  } catch (err) {
    throw new AppError(err.message || 'Invalid refresh token', 401, 'UNAUTHORIZED');
  }
};

// ── POST /auth/logout ────────────────────────────────────────────────────────
const logout = async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    await TokenService.revokeToken(refreshToken);
  }
  return sendSuccess(res, null, 'Logged out successfully');
};

// ── POST /auth/logout-all ────────────────────────────────────────────────────
const logoutAll = async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    if (refreshToken.includes('.')) {
      const [b64Id, ] = refreshToken.split('.');
      const userId = Buffer.from(b64Id, 'base64').toString('utf8');
      if (userId) {
        await TokenService.revokeAllUserTokens(userId);
      }
    }
  }
  return sendSuccess(res, null, 'Logged out of all sessions successfully');
};

module.exports = { ssoLogin, refresh, logout, logoutAll };
