const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { paginate } = require('../utils/pagination');
const { invalidatePublicFeed } = require('../utils/cacheInvalidation');

const resolveAuthorName = (username, settingsStr) => {
  if (settingsStr) {
    try {
      const settings = JSON.parse(settingsStr);
      if (settings.publicProfile === false) {
        return 'Anonymous User';
      }
    } catch (e) {}
  }
  return username;
};

// ── GET / — Public paginated feed ─────────────────────────────────────────────
const getPublicFeed = async (req, res) => {
  const { page, limit = 20, type } = req.query;

  let query = `
    SELECT p.id, p.content, p.type, p.likes, p.created_at, u.username AS author_username, u.settings AS author_settings
    FROM public_posts p
    JOIN users u ON u.id = p.user_id
    WHERE 1=1
  `;
  const params = [];

  if (type) { query += ' AND p.type = ?'; params.push(type); }
  query += ' ORDER BY p.created_at DESC';

  const result = await paginate(query, params, page, limit, db);
  const rows = result.rows.map(({ author_username, author_settings, ...post }) => ({
    ...post,
    author: { username: resolveAuthorName(author_username, author_settings) },
  }));

  return sendSuccess(res, rows, 'Public feed fetched', 200, result.meta);
};

// ── POST / — Create post (auth required) ──────────────────────────────────────
const createPost = async (req, res) => {
  const { content, type = 'update' } = req.body;

  const now = new Date().toISOString();
  const info = await db.prepare(`
    INSERT INTO public_posts (user_id, content, type, likes, created_at, updated_at)
    VALUES (?, ?, ?, 0, ?, ?)
  `).run(req.user.id, content, type, now, now);

  const newPost = await db.prepare(`
    SELECT p.id, p.content, p.type, p.likes, p.created_at, u.username AS author_username, u.settings AS author_settings
    FROM public_posts p JOIN users u ON u.id = p.user_id
    WHERE p.id = ?
  `).get(info.lastInsertRowid);

  const { author_username, author_settings, ...post } = newPost;
  await invalidatePublicFeed();
  return sendSuccess(res, { ...post, author: { username: resolveAuthorName(author_username, author_settings) } }, 'Post created', 201);
};

// ── PATCH /:id/like — Increment likes (rate-limited, no auth) ─────────────────
const likePost = async (req, res) => {
  const post = await db.prepare('SELECT id FROM public_posts WHERE id = ?').get(req.params.id);
  if (!post) return sendError(res, 'Post not found', 404, 'NOT_FOUND');

  await db.prepare('UPDATE public_posts SET likes = likes + 1, updated_at = ? WHERE id = ?')
    .run(new Date().toISOString(), req.params.id);

  const updated = await db.prepare('SELECT id, likes FROM public_posts WHERE id = ?').get(req.params.id);
  await invalidatePublicFeed();
  return sendSuccess(res, updated, 'Post liked');
};

// ── DELETE /:id — Author only (auth required) ─────────────────────────────────
const deletePost = async (req, res) => {
  const post = await db.prepare('SELECT * FROM public_posts WHERE id = ?').get(req.params.id);
  if (!post) return sendError(res, 'Post not found', 404, 'NOT_FOUND');
  if (post.user_id !== req.user.id) return sendError(res, 'Forbidden', 403, 'FORBIDDEN');

  await db.prepare('DELETE FROM public_posts WHERE id = ?').run(req.params.id);
  await invalidatePublicFeed();
  return res.status(204).end();
};

// ── GET /announcement — Fetch the latest active broadcast alert ─────────────────
const getActiveAnnouncement = async (req, res) => {
  try {
    const active = await db.prepare(`
      SELECT title, message, banner_type, created_at 
      FROM platform_announcements 
      WHERE is_active = 1 OR is_active = '1'
      ORDER BY id DESC 
      LIMIT 1
    `).get();
    
    if (!active) {
      return sendSuccess(res, null, 'No active announcements.');
    }
    
    return sendSuccess(res, active, 'Active platform announcement loaded.');
  } catch (err) {
    return sendSuccess(res, null);
  }
};

module.exports = { getPublicFeed, createPost, likePost, deletePost, getActiveAnnouncement };
