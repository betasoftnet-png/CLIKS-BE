const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

const ensureReferralsTable = async () => {
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS referrals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        referrer_id INTEGER,
        referrerId INTEGER,
        referee_id INTEGER,
        refereeId INTEGER,
        referee_name TEXT,
        refereeName TEXT,
        referee_email TEXT,
        refereeEmail TEXT,
        code TEXT,
        referral_code TEXT,
        status TEXT DEFAULT 'Joined',
        stage TEXT DEFAULT 'ACTIVE',
        bonus_points INTEGER DEFAULT 200,
        bonusPoints INTEGER DEFAULT 200,
        points_earned INTEGER DEFAULT 200,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch (e) {}

  try { await db.prepare("ALTER TABLE users ADD COLUMN referral_code TEXT").run(); } catch (e) {}
  try { await db.prepare("ALTER TABLE users ADD COLUMN is_verified INTEGER DEFAULT 1").run(); } catch (e) {}
  try { await db.prepare("ALTER TABLE users ADD COLUMN referral_points INTEGER DEFAULT 0").run(); } catch (e) {}
};

/**
 * GET /referrals
 * Returns all referrals attributed to the logged-in referrer
 */
const getReferrals = async (req, res) => {
  await ensureReferralsTable();
  const userId = req.user?.id;
  if (!userId) {
    return sendError(res, 'Authentication required', 401, 'UNAUTHORIZED');
  }

  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const userCode = user?.referral_code ? user.referral_code.toUpperCase() : '';

  let rows = [];
  try {
    if (userCode) {
      rows = await db.prepare(`
        SELECT * FROM referrals 
        WHERE referrer_id = ? OR referrerId = ? OR UPPER(code) = ? OR UPPER(referral_code) = ?
        ORDER BY id DESC
      `).all(userId, userId, userCode, userCode);
    } else {
      rows = await db.prepare(`
        SELECT * FROM referrals 
        WHERE referrer_id = ? OR referrerId = ?
        ORDER BY id DESC
      `).all(userId, userId);
    }
  } catch (err) {
    console.error('[getReferrals Error]', err.message);
  }

  // Map to dashboard-friendly structure matching frontend expectations
  const formatted = (rows || []).map(r => ({
    id: r.id ? `ref-${r.id}` : `ref-${Date.now()}`,
    name: r.referee_name || r.refereeName || r.name || 'Friend',
    email: r.referee_email || r.refereeEmail || r.email || '',
    stage: (r.status === 'Active' || r.status === 'Joined') ? 'ACTIVE' : (r.stage || 'REGISTERED'),
    status: r.status || 'Joined',
    code: r.code || r.referral_code || '',
    registered_at: (r.created_at || r.createdAt || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
    points_earned: Number(r.bonus_points || r.bonusPoints || r.points_earned || 200),
    claimed_stages: ['SETUP_COMPLETE', 'ACTIVE']
  }));

  return sendSuccess(res, formatted, 'Referrals retrieved successfully', 200, {
    total: formatted.length,
    active_users: formatted.filter(r => r.stage === 'ACTIVE' || r.stage === 'PREMIUM').length
  });
};

module.exports = {
  getReferrals,
  ensureReferralsTable
};
