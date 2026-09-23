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
        status TEXT DEFAULT 'Registered (Active)',
        stage TEXT DEFAULT 'Active User',
        reward_earned TEXT DEFAULT '200 Points',
        rewardEarned TEXT DEFAULT '200 Points',
        bonus_points INTEGER DEFAULT 200,
        bonusPoints INTEGER DEFAULT 200,
        points_earned INTEGER DEFAULT 200,
        joined_date TEXT,
        joinedDate TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch (e) {}

  const referralCols = [
    'referrer_id INTEGER', 'referrerId INTEGER', 'referee_id INTEGER', 'refereeId INTEGER',
    'referee_name TEXT', 'refereeName TEXT', 'referee_email TEXT', 'refereeEmail TEXT',
    'code TEXT', 'referral_code TEXT', 'status TEXT', 'stage TEXT',
    'reward_earned TEXT', 'rewardEarned TEXT', 'bonus_points INTEGER', 'bonusPoints INTEGER',
    'points_earned INTEGER', 'joined_date TEXT', 'joinedDate TEXT',
    'created_at TEXT', 'createdAt TEXT'
  ];
  for (const col of referralCols) {
    try { await db.prepare(`ALTER TABLE referrals ADD COLUMN ${col}`).run(); } catch (e) {}
  }

  try { await db.prepare("ALTER TABLE users ADD COLUMN referral_code TEXT").run(); } catch (e) {}
  try { await db.prepare("ALTER TABLE users ADD COLUMN is_verified INTEGER DEFAULT 1").run(); } catch (e) {}
  try { await db.prepare("ALTER TABLE users ADD COLUMN referral_points INTEGER DEFAULT 0").run(); } catch (e) {}
  try { await db.prepare("ALTER TABLE users ADD COLUMN referred_by_code TEXT").run(); } catch (e) {}
  try { await db.prepare("ALTER TABLE users ADD COLUMN referrer_id INTEGER").run(); } catch (e) {}
};

/**
 * GET /referrals, GET /api/referrals/my-referrals, GET /referrals/my-referrals
 * Returns all referrals attributed to the referrer (by auth user ID or ?code=CLIKS-BIZ-XXXXXX)
 */
const getReferrals = async (req, res) => {
  await ensureReferralsTable();
  const userId = req.user?.id;
  const queryCode = (req.query?.code || req.query?.referralCode || '').trim().toUpperCase();

  let userCode = '';
  if (userId) {
    try {
      const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      userCode = user?.referral_code ? user.referral_code.toUpperCase() : '';
    } catch (e) {}
  }

  const searchCode = queryCode || userCode;

  let rows = [];
  try {
    if (userId && searchCode) {
      rows = await db.prepare(`
        SELECT * FROM referrals 
        WHERE referrer_id = ? OR referrerId = ? OR UPPER(code) = ? OR UPPER(referral_code) = ?
        ORDER BY id DESC
      `).all(userId, userId, searchCode, searchCode);
    } else if (userId) {
      rows = await db.prepare(`
        SELECT * FROM referrals 
        WHERE referrer_id = ? OR referrerId = ?
        ORDER BY id DESC
      `).all(userId, userId);
    } else if (searchCode) {
      rows = await db.prepare(`
        SELECT * FROM referrals 
        WHERE UPPER(code) = ? OR UPPER(referral_code) = ?
        ORDER BY id DESC
      `).all(searchCode, searchCode);
    } else {
      rows = await db.prepare(`
        SELECT * FROM referrals 
        ORDER BY id DESC LIMIT 50
      `).all();
    }
  } catch (err) {
    console.error('[getReferrals Error]', err.message);
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  // Map to dashboard-friendly structure matching frontend expectations
  const formatted = (rows || []).map(r => {
    const rawDate = r.joinedDate || r.joined_date || (r.createdAt || r.created_at || '').slice(0, 10) || todayStr;
    const isToday = rawDate === todayStr;
    return {
      id: r.id ? `ref-${r.id}` : `ref-${Date.now()}`,
      referrerId: r.referrerId || r.referrer_id,
      refereeId: r.refereeId || r.referee_id,
      name: r.refereeName || r.referee_name || r.name || 'Friend',
      refereeName: r.refereeName || r.referee_name || r.name || 'Friend',
      email: r.refereeEmail || r.referee_email || r.email || '',
      refereeEmail: r.refereeEmail || r.referee_email || r.email || '',
      stage: r.stage || (r.status === 'Active' || r.status === 'Registered (Active)' ? 'Active User' : 'Registered'),
      status: r.status || 'Registered (Active)',
      code: r.code || r.referral_code || '',
      rewardEarned: r.rewardEarned || r.reward_earned || `${r.bonusPoints || r.bonus_points || 200} Points`,
      reward_earned: r.rewardEarned || r.reward_earned || `${r.bonusPoints || r.bonus_points || 200} Points`,
      joinedDate: rawDate,
      joined_date: rawDate,
      registered_at: isToday ? `Today / ${rawDate}` : rawDate,
      points_earned: Number(r.bonusPoints || r.bonus_points || r.points_earned || 200),
      claimed_stages: ['SETUP_COMPLETE', 'ACTIVE']
    };
  });

  return sendSuccess(res, formatted, 'Referrals retrieved successfully', 200, {
    total: formatted.length,
    active_users: formatted.filter(r => r.stage === 'ACTIVE' || r.stage === 'Active User' || r.stage === 'PREMIUM').length
  });
};

module.exports = {
  getReferrals,
  ensureReferralsTable
};
