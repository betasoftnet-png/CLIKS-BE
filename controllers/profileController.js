const bcrypt = require('bcryptjs');
const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

// Helper: strip password_hash from user row
const safeUser = (user) => {
  if (!user) return null;
  const { password_hash, ...safe } = user;
  return safe;
};

// ── GET / — Return current user ───────────────────────────────────────────────
const getProfile = async (req, res) => {
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return sendError(res, 'User not found', 404, 'NOT_FOUND');
  return sendSuccess(res, safeUser(user));
};

// ── PATCH / — Update username or email ───────────────────────────────────────
const updateProfile = async (req, res) => {
  const { username, email } = req.body;

  if (!username && !email) {
    return sendError(res, 'Provide at least one field to update (username or email)', 400, 'BAD_REQUEST');
  }

  const current = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!current) return sendError(res, 'User not found', 404, 'NOT_FOUND');

  // Check email uniqueness if changing
  if (email && email !== current.email) {
    const existing = await db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, req.user.id);
    if (existing) return sendError(res, 'Email is already in use by another account', 409, 'CONFLICT');
  }

  const updates = [];
  const params = [];

  if (username !== undefined) { updates.push('username = ?'); params.push(username); }
  if (email !== undefined)    { updates.push('email = ?');    params.push(email); }

  updates.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(req.user.id);

  await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const updated = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  return sendSuccess(res, safeUser(updated), 'Profile updated');
};

// ── PATCH /change-password ────────────────────────────────────────────────────
const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return sendError(res, 'currentPassword and newPassword are required', 400, 'BAD_REQUEST');
  }

  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return sendError(res, 'User not found', 404, 'NOT_FOUND');

  const valid = bcrypt.compareSync(currentPassword, user.password_hash);
  if (!valid) return sendError(res, 'Current password is incorrect', 401, 'UNAUTHORIZED');

  const newHash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
    .run(newHash, new Date().toISOString(), req.user.id);

  return sendSuccess(res, { message: 'Password updated' }, 'Password updated');
};

module.exports = { getProfile, updateProfile, changePassword };
