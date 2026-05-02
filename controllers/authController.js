const bcrypt = require('bcryptjs');
const { z } = require('zod');

const db = require('../db/connection');
const { sendSuccess } = require('../utils/response');
const AppError = require('../utils/AppError');
const TokenService = require('../utils/tokenService');

// ── Zod Schemas ───────────────────────────────────────────────────────────────
const registerSchema = z.object({
  body: z.object({
    username: z.string().min(1, 'Username is required').max(50),
    email: z.string().email('Valid email required'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    role: z.enum(['user', 'business']).optional(),
    business_name: z.string().optional(),
    business_type: z.string().optional(),
    industry: z.string().optional(),
  })
});

const loginSchema = z.object({
  body: z.object({
    email: z.string().email('Valid email required').optional(),
    username: z.string().min(1).max(50).optional(),
    password: z.string().min(1, 'Password is required'),
  }).refine(data => data.email || data.username, {
    message: 'Provide email or username',
    path: ['email']
  })
});

const register = async (req, res) => {
  const { username, email, password, role, business_name, business_type, industry } = req.body;
  const userRole = role === 'business' ? 'business' : 'user';

  const existingEmail = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existingEmail) throw new AppError('Email already registered', 409, 'CONFLICT');

  const existingUsername = await db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existingUsername) throw new AppError('Username already taken', 409, 'CONFLICT');

  const hash = bcrypt.hashSync(password, 10);
  const now = new Date().toISOString();

  const info = await db.prepare(
    'INSERT INTO users (username, email, password_hash, role, business_name, business_type, industry, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(username, email, hash, userRole, business_name || null, business_type || null, industry || null, now, now);

  const user = await db.prepare('SELECT id, username, email, role, business_name, business_type, industry, created_at FROM users WHERE id = ?').get(info.lastInsertRowid || info.id || info[0]?.id);

  const { accessToken, refreshToken } = await TokenService.issueEnhancedTokens(user);

  return sendSuccess(res, { accessToken, refreshToken, user }, 'Account created successfully', 201);
};

// ── POST /auth/login ──────────────────────────────────────────────────────────
const login = async (req, res) => {
  const { email, username, password } = req.body;

  const user = email
    ? await db.prepare('SELECT * FROM users WHERE email = ?').get(email)
    : await db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (!user) throw new AppError('Invalid credentials', 401, 'UNAUTHORIZED');

  const isMatch = bcrypt.compareSync(password, user.password_hash);
  if (!isMatch) throw new AppError('Invalid credentials', 401, 'UNAUTHORIZED');

  const { accessToken, refreshToken } = await TokenService.issueEnhancedTokens(user);

  const safeUser = { id: user.id, username: user.username, email: user.email, role: user.role, created_at: user.created_at };
  return sendSuccess(res, { accessToken, refreshToken, user: safeUser }, 'Logged in successfully');
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

module.exports = { registerSchema, loginSchema, register, login, refresh, logout, logoutAll };
