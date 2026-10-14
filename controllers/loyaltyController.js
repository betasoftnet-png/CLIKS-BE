const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

// ── GET /api/v1/loyalty/program-settings ──────────────────────────────────────────
const getProgramSettings = async (req, res) => {
  try {
    const userId = req.user.id;
    let row = await db.prepare('SELECT * FROM business_loyalty_settings WHERE user_id = ?').get(userId);

    if (!row) {
      // Check legacy users.settings as fallback migration
      let legacySettings = {};
      try {
        const u = await db.prepare('SELECT settings FROM users WHERE id = ?').get(userId);
        if (u && u.settings) legacySettings = JSON.parse(u.settings);
      } catch (e) {}

      const isEnabled = legacySettings.loyaltyEnabled !== undefined 
        ? (legacySettings.loyaltyEnabled ? 1 : 0) 
        : (legacySettings.loyalty !== undefined ? (legacySettings.loyalty ? 1 : 0) : 1);

      const rsPer1Point = Number(legacySettings.loyaltyRsPer1Point) || 100;
      const pointsPer1Rs = Number(legacySettings.loyaltyPointsPer1Rs) || 100;
      const maxClaimPct = Number(legacySettings.loyaltyMaxClaimPercent) || 50;

      const now = new Date().toISOString();
      try {
        await db.prepare(`
          INSERT INTO business_loyalty_settings (user_id, loyalty_enabled, rs_per_point, points_per_rs, max_claim_percent, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(userId, isEnabled, rsPer1Point, pointsPer1Rs, maxClaimPct, now, now);
      } catch (insertErr) {
        // Ignored if race condition inserted it
      }

      row = {
        user_id: userId,
        loyalty_enabled: isEnabled,
        rs_per_point: rsPer1Point,
        points_per_rs: pointsPer1Rs,
        max_claim_percent: maxClaimPct,
        created_at: now,
        updated_at: now
      };
    }

    const loyaltyEnabled = Boolean(row.loyalty_enabled);
    return sendSuccess(res, {
      loyaltyEnabled: loyaltyEnabled,
      loyalty: loyaltyEnabled,
      loyaltyRsPer1Point: Number(row.rs_per_point) || 100,
      loyaltyPointsPer1Rs: Number(row.points_per_rs) || 100,
      loyaltyMaxClaimPercent: Number(row.max_claim_percent) || 50,
      updatedAt: row.updated_at
    }, 'Loyalty program settings fetched');
  } catch (error) {
    console.error('[Loyalty Controller] Error fetching program settings:', error);
    return sendError(res, 'Failed to fetch loyalty program settings', 500);
  }
};

// ── PATCH /api/v1/loyalty/program-settings ────────────────────────────────────────
const updateProgramSettings = async (req, res) => {
  try {
    const userId = req.user.id;
    const body = req.body || {};

    let existing = await db.prepare('SELECT * FROM business_loyalty_settings WHERE user_id = ?').get(userId);
    const now = new Date().toISOString();

    let enabledVal = 1;
    if (body.loyaltyEnabled !== undefined) {
      enabledVal = body.loyaltyEnabled ? 1 : 0;
    } else if (body.loyalty !== undefined) {
      enabledVal = body.loyalty ? 1 : 0;
    } else if (existing) {
      enabledVal = existing.loyalty_enabled;
    }

    const rsPerPoint = body.loyaltyRsPer1Point !== undefined 
      ? Number(body.loyaltyRsPer1Point) 
      : (existing ? existing.rs_per_point : 100);

    const pointsPerRs = body.loyaltyPointsPer1Rs !== undefined 
      ? Number(body.loyaltyPointsPer1Rs) 
      : (existing ? existing.points_per_rs : 100);

    const maxClaimPct = body.loyaltyMaxClaimPercent !== undefined 
      ? Number(body.loyaltyMaxClaimPercent) 
      : (existing ? existing.max_claim_percent : 50);

    if (existing) {
      await db.prepare(`
        UPDATE business_loyalty_settings 
        SET loyalty_enabled = ?, rs_per_point = ?, points_per_rs = ?, max_claim_percent = ?, updated_at = ?
        WHERE user_id = ?
      `).run(enabledVal, rsPerPoint, pointsPerRs, maxClaimPct, now, userId);
    } else {
      await db.prepare(`
        INSERT INTO business_loyalty_settings (user_id, loyalty_enabled, rs_per_point, points_per_rs, max_claim_percent, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(userId, enabledVal, rsPerPoint, pointsPerRs, maxClaimPct, now, now);
    }

    // Keep users.settings in sync
    try {
      const u = await db.prepare('SELECT settings FROM users WHERE id = ?').get(userId);
      let s = {};
      if (u && u.settings) {
        try { s = JSON.parse(u.settings); } catch (e) {}
      }
      s.loyaltyEnabled = Boolean(enabledVal);
      s.loyalty = Boolean(enabledVal);
      s.loyaltyRsPer1Point = rsPerPoint;
      s.loyaltyPointsPer1Rs = pointsPerRs;
      s.loyaltyMaxClaimPercent = maxClaimPct;
      await db.prepare('UPDATE users SET settings = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(s), now, userId);
    } catch (e) {}

    const loyaltyEnabled = Boolean(enabledVal);
    return sendSuccess(res, {
      loyaltyEnabled: loyaltyEnabled,
      loyalty: loyaltyEnabled,
      loyaltyRsPer1Point: rsPerPoint,
      loyaltyPointsPer1Rs: pointsPerRs,
      loyaltyMaxClaimPercent: maxClaimPct,
      updatedAt: now
    }, 'Loyalty program settings updated');
  } catch (error) {
    console.error('[Loyalty Controller] Error updating program settings:', error);
    return sendError(res, 'Failed to update loyalty program settings', 500);
  }
};

module.exports = {
  getProgramSettings,
  updateProgramSettings
};
