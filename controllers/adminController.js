const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { invalidatePublicFeed } = require('../utils/cacheInvalidation');

// ── GET /users — List all users ──────────────────────────────────────────
const getUsers = async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  const users = await db.prepare(
    'SELECT id, username, email, role, created_at FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(limit, offset);

  return sendSuccess(res, users, 'Users fetched successfully', 200);
};

// ── DELETE /users/:id — Delete user ──────────────────────────────────────
const deleteUser = async (req, res) => {
  const userId = req.params.id;

  if (userId == req.user.id) {
    return sendError(res, 'Cannot delete yourself', 400, 'BAD_REQUEST');
  }

  const user = await db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) return sendError(res, 'User not found', 404, 'NOT_FOUND');

  await db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  await db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(userId);
  
  return res.status(204).end();
};

// ── DELETE /public/:id — Manage (Delete) public posts ────────────────────
const deletePublicPost = async (req, res) => {
  const post = await db.prepare('SELECT id FROM public_posts WHERE id = ?').get(req.params.id);
  if (!post) return sendError(res, 'Post not found', 404, 'NOT_FOUND');

  await db.prepare('DELETE FROM public_posts WHERE id = ?').run(req.params.id);
  await invalidatePublicFeed();
  
  return res.status(204).end();
};

// ── PATCH /users/:id/role — Change user role ─────────────────────────────
const updateUserRole = async (req, res) => {
  const { role } = req.body;
  if (!['admin', 'user'].includes(role)) {
    return sendError(res, 'Invalid role', 400, 'BAD_REQUEST');
  }

  const user = await db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return sendError(res, 'User not found', 404, 'NOT_FOUND');

  await db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  
  return sendSuccess(res, null, 'User role updated successfully');
};

module.exports = { getUsers, deleteUser, deletePublicPost, updateUserRole };
