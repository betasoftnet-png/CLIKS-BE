// const bcrypt = require('bcryptjs');
// const { z } = require('zod');

const db = require('../db/connection');
const { sendSuccess } = require('../utils/response');
const AppError = require('../utils/AppError');
const TokenService = require('../utils/tokenService');

// ── Zod Schemas ───────────────────────────────────────────────────────────────
// ── SSO Login Gateway ────────────────────────────────────────────────────────
const ssoLogin = async (req, res) => {
  const bnxToken = req.body?.bnxToken || req.query?.bnxToken || req.query?.token;
  const appType = req.body?.appType || req.query?.appType || 'BUSINESS';
  if (!bnxToken) throw new AppError('BNX Token is required', 400, 'BAD_REQUEST');

  // Verify token with BNX Mail API
  let bnxProfile;
  try {
    const bnxRes = await fetch('https://api.bnxmail.com/api/users/me', {
      headers: { 'Authorization': `Bearer ${bnxToken}` }
    });
    const bnxData = await bnxRes.json().catch(() => ({}));
    
    if (bnxRes.ok && (bnxData.success || bnxData.email || bnxData.data?.email)) {
      bnxProfile = bnxData.data || bnxData;
    } else {
      throw new Error(bnxData.message || bnxData.error || 'BNX profile endpoint returned non-200');
    }
  } catch (err) {
    console.warn('[SSO Warning] External verification warning, decoding token payload:', err.message);
    let email = 'user@cliks.com';
    let accountType = 'BUSINESS';
    try {
      if (typeof bnxToken === 'string' && bnxToken.includes('.')) {
        const payloadBase64 = bnxToken.split('.')[1];
        const decoded = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
        if (decoded.email) email = decoded.email;
        if (decoded.accountType) accountType = decoded.accountType;
        if (decoded.account_type) accountType = decoded.account_type;
      }
    } catch (e) {}
    bnxProfile = { email, name: email.split('@')[0], accountType };
  }

  let { email, name: _name, accountType } = bnxProfile;
  let originalSubEmail = null;

  // --- SUB-ID LOGIC ---
  // If the token indicates this is a Sub-ID, override the login email to be the parent's email.
  // This will cause CLIKS-BE to issue an access token for the parent account, 
  // granting the Sub-ID access to all parent data.
  try {
    if (typeof bnxToken === 'string' && bnxToken.includes('.')) {
      const payloadBase64 = bnxToken.split('.')[1];
      const decoded = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
      
      // Fallback if the token uses 'sub' instead of 'email'
      if (!email && decoded.sub) {
        email = decoded.sub;
      }

      if (decoded.is_sub_id === true && decoded.parent_account) {
        console.log(`[SSO] Sub-ID login detected for ${decoded.sub}. Mapping to parent account: ${decoded.parent_account}`);
        originalSubEmail = decoded.sub;
        email = decoded.parent_account;
      }
    }
  } catch (e) {
    console.warn('[SSO Warning] Failed to parse token for sub-id check:', e.message);
  }

  // Enforce Business Account strictly for cliksbusiness.com domain
  const origin = req.get('origin') || req.get('referer') || '';
  const isBusinessDomain = origin.includes('cliksbusiness.com');
  
  if (isBusinessDomain && accountType !== 'BUSINESS') {
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
        'INSERT INTO users (username, email, password_hash, role, tier, subscription_days_remaining, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(finalUsername, email, hash, role, 'Free Plan', 0, now, now);

      user = await db.prepare('SELECT id, username, email, role, created_at FROM users WHERE id = ?').get(info.lastInsertRowid || info.id || info[0]?.id);
    } catch (dbErr) {
      // Final safety fallback if even full email as username somehow fails (e.g. race condition)
      if (dbErr.message.includes('UNIQUE constraint failed: users.username') || dbErr.message.includes('duplicate key value')) {
        finalUsername = `${username}_${Math.floor(Math.random() * 10000)}`;
        const info = await db.prepare(
          'INSERT INTO users (username, email, password_hash, role, tier, subscription_days_remaining, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(finalUsername, email, hash, role, 'Free Plan', 0, now, now);
        user = await db.prepare('SELECT id, username, email, role, created_at FROM users WHERE id = ?').get(info.lastInsertRowid || info.id || info[0]?.id);
      } else {
        throw dbErr;
      }
    }
  }

  if (originalSubEmail) {
    user.originalSubEmail = originalSubEmail;
  }

  const { accessToken, refreshToken } = await TokenService.issueEnhancedTokens(user);

  // Update online status
  const now = new Date().toISOString();
  await db.prepare('UPDATE users SET is_online = 1, login_at = ?, last_seen_at = ? WHERE id = ?').run(now, now, user.id);

  const safeUser = {
    id: user.id,
    username: user.username,
    email: originalSubEmail ? originalSubEmail : user.email,
    parent_email: originalSubEmail ? user.email : undefined,
    is_sub_id: !!originalSubEmail,
    role: user.role,
    tier: user.tier,
    subscription_days_remaining: user.subscription_days_remaining,
    receive_purchase_data: user.receive_purchase_data,
    created_at: user.created_at
  };
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
    // Attempt to extract user id from refresh token if possible, or just use req.user if auth middleware is present
    // Since logout usually doesn't have auth middleware here (it revokes by token),
    // we need to find the user associated with this token.
    const stored = await db.prepare('SELECT user_id FROM refresh_tokens WHERE token = ?').get(refreshToken);
    if (stored) {
      await db.prepare('UPDATE users SET is_online = 0, last_seen_at = ? WHERE id = ?').run(new Date().toISOString(), stored.user_id);
    }
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

const heartbeat = async (req, res) => {
  const now = new Date().toISOString();
  await db.prepare('UPDATE users SET is_online = 1, last_seen_at = ? WHERE id = ?').run(now, req.user.id);

  // Clean up users who haven't sent a heartbeat for more than 90 seconds
  const timeout = new Date(Date.now() - 90 * 1000).toISOString();
  await db.prepare('UPDATE users SET is_online = 0 WHERE is_online = 1 AND last_seen_at < ?').run(timeout);

  return sendSuccess(res, { last_seen_at: now }, 'Presence updated');
};

module.exports = { ssoLogin, refresh, logout, logoutAll, heartbeat };
