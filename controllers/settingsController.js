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

  // Retrieve dedicated business loyalty settings from database table
  try {
    const lRow = await db.prepare('SELECT * FROM business_loyalty_settings WHERE user_id = ?').get(req.user.id);
    if (lRow) {
      const isEnabled = Boolean(lRow.loyalty_enabled);
      settings.loyaltyEnabled = isEnabled;
      settings.loyalty = isEnabled;
      settings.loyaltyRsPer1Point = Number(lRow.rs_per_point) || 100;
      settings.loyaltyPointsPer1Rs = Number(lRow.points_per_rs) || 100;
      settings.loyaltyMaxClaimPercent = Number(lRow.max_claim_percent) || 50;
    } else {
      if (settings.loyaltyEnabled === undefined && settings.loyalty === undefined) {
        settings.loyaltyEnabled = true;
        settings.loyalty = true;
      }
    }
  } catch (e) {
    console.warn('[Settings] Error checking business_loyalty_settings:', e.message);
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

  // Sync loyalty keys to business_loyalty_settings table in database
  if (incoming.loyaltyEnabled !== undefined || incoming.loyalty !== undefined || incoming.loyaltyRsPer1Point !== undefined || incoming.loyaltyPointsPer1Rs !== undefined || incoming.loyaltyMaxClaimPercent !== undefined) {
    try {
      const now = new Date().toISOString();
      const existingL = await db.prepare('SELECT * FROM business_loyalty_settings WHERE user_id = ?').get(req.user.id);
      const isEnabled = incoming.loyaltyEnabled !== undefined 
        ? (incoming.loyaltyEnabled ? 1 : 0) 
        : (incoming.loyalty !== undefined ? (incoming.loyalty ? 1 : 0) : (existingL ? existingL.loyalty_enabled : 1));
      const rsPoint = incoming.loyaltyRsPer1Point !== undefined ? Number(incoming.loyaltyRsPer1Point) : (existingL ? existingL.rs_per_point : 100);
      const ptRs = incoming.loyaltyPointsPer1Rs !== undefined ? Number(incoming.loyaltyPointsPer1Rs) : (existingL ? existingL.points_per_rs : 100);
      const maxClaim = incoming.loyaltyMaxClaimPercent !== undefined ? Number(incoming.loyaltyMaxClaimPercent) : (existingL ? existingL.max_claim_percent : 50);

      if (existingL) {
        await db.prepare('UPDATE business_loyalty_settings SET loyalty_enabled = ?, rs_per_point = ?, points_per_rs = ?, max_claim_percent = ?, updated_at = ? WHERE user_id = ?')
          .run(isEnabled, rsPoint, ptRs, maxClaim, now, req.user.id);
      } else {
        await db.prepare('INSERT INTO business_loyalty_settings (user_id, loyalty_enabled, rs_per_point, points_per_rs, max_claim_percent, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(req.user.id, isEnabled, rsPoint, ptRs, maxClaim, now, now);
      }
      merged.loyaltyEnabled = Boolean(isEnabled);
      merged.loyalty = Boolean(isEnabled);
    } catch (e) {
      console.warn('[Settings] Failed to sync business_loyalty_settings table:', e.message);
    }
  }

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

  // Sync loyalty keys to business_loyalty_settings table in database
  if (settings.loyaltyEnabled !== undefined || settings.loyalty !== undefined) {
    try {
      const now = new Date().toISOString();
      const isEnabled = settings.loyaltyEnabled !== undefined ? (settings.loyaltyEnabled ? 1 : 0) : (settings.loyalty ? 1 : 0);
      const rsPoint = Number(settings.loyaltyRsPer1Point) || 100;
      const ptRs = Number(settings.loyaltyPointsPer1Rs) || 100;
      const maxClaim = Number(settings.loyaltyMaxClaimPercent) || 50;

      const existingL = await db.prepare('SELECT * FROM business_loyalty_settings WHERE user_id = ?').get(req.user.id);
      if (existingL) {
        await db.prepare('UPDATE business_loyalty_settings SET loyalty_enabled = ?, rs_per_point = ?, points_per_rs = ?, max_claim_percent = ?, updated_at = ? WHERE user_id = ?')
          .run(isEnabled, rsPoint, ptRs, maxClaim, now, req.user.id);
      } else {
        await db.prepare('INSERT INTO business_loyalty_settings (user_id, loyalty_enabled, rs_per_point, points_per_rs, max_claim_percent, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(req.user.id, isEnabled, rsPoint, ptRs, maxClaim, now, now);
      }
    } catch (e) {
      console.warn('[Settings] Failed to replace business_loyalty_settings:', e.message);
    }
  }

  await db.prepare('UPDATE users SET settings = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(settings), new Date().toISOString(), req.user.id);

  return sendSuccess(res, settings, 'Settings replaced');
};

module.exports = { getSettings, updateSettings, replaceSettings };
