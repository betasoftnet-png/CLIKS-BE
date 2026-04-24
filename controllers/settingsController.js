const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

// ── GET / — Get user settings ─────────────────────────────────────────────────
const getSettings = async (req, res) => {
  const user = await db.prepare('SELECT settings FROM users WHERE id = ?').get(req.user.id);
  if (!user) return sendError(res, 'User not found', 404, 'NOT_FOUND');

  let settings = {};
  if (user.settings) {
    try {
      settings = JSON.parse(user.settings);
    } catch {
      settings = {};
    }
  }

  return sendSuccess(res, settings, 'Settings fetched');
};

// ── PATCH / — Update user settings (deep merge) ───────────────────────────────
const updateSettings = async (req, res) => {
  const incoming = req.body;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return sendError(res, 'Settings must be a JSON object', 400, 'BAD_REQUEST');
  }

  const user = await db.prepare('SELECT settings FROM users WHERE id = ?').get(req.user.id);
  if (!user) return sendError(res, 'User not found', 404, 'NOT_FOUND');

  // Deep merge: existing settings + incoming changes
  let existing = {};
  if (user.settings) {
    try { existing = JSON.parse(user.settings); } catch { existing = {}; }
  }
  const merged = { ...existing, ...incoming };

  await db.prepare('UPDATE users SET settings = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(merged), new Date().toISOString(), req.user.id);

  return sendSuccess(res, merged, 'Settings updated');
};

// ── PUT / — Replace user settings entirely ────────────────────────────────────
const replaceSettings = async (req, res) => {
  const settings = req.body;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return sendError(res, 'Settings must be a JSON object', 400, 'BAD_REQUEST');
  }

  const user = await db.prepare('SELECT id FROM users WHERE id = ?').get(req.user.id);
  if (!user) return sendError(res, 'User not found', 404, 'NOT_FOUND');

  await db.prepare('UPDATE users SET settings = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(settings), new Date().toISOString(), req.user.id);

  return sendSuccess(res, settings, 'Settings replaced');
};

module.exports = { getSettings, updateSettings, replaceSettings };
