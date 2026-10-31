const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

const DEFAULT_TIERS = [
  {
    id: 'bronze',
    name: 'Bronze Club',
    min_spend: 0,
    multiplier: 1.0,
    color: '#CD7F32',
    badge_bg: '#FEF3C7',
    badge_text: '#92400E',
    perks: 'Standard earning rate (1x), Birthday bonus'
  },
  {
    id: 'silver',
    name: 'Silver Star',
    min_spend: 5000,
    multiplier: 1.25,
    color: '#94A3B8',
    badge_bg: '#F1F5F9',
    badge_text: '#334155',
    perks: '1.25x Points multiplier + Early access to seasonal sales'
  },
  {
    id: 'gold',
    name: 'Gold Premier',
    min_spend: 15000,
    multiplier: 1.5,
    color: '#EAB308',
    badge_bg: '#FEF9C3',
    badge_text: '#854D0E',
    perks: '1.5x Points multiplier + Priority express service'
  },
  {
    id: 'platinum',
    name: 'Platinum Elite',
    min_spend: 50000,
    multiplier: 2.0,
    color: '#6366F1',
    badge_bg: '#EEF2FF',
    badge_text: '#3730A3',
    perks: '2x Points on all purchases + Dedicated VIP manager'
  }
];

let ensureColumnsInit = false;
const ensureLoyaltyColumns = async () => {
  if (ensureColumnsInit) return;
  const alters = [
    'ALTER TABLE business_loyalty_settings ADD COLUMN print_show_loyalty INTEGER DEFAULT 0',
    'ALTER TABLE business_loyalty_settings ADD COLUMN print_show_credit INTEGER DEFAULT 0',
    'ALTER TABLE business_loyalty_settings ADD COLUMN print_show_gst INTEGER DEFAULT 1',
    "ALTER TABLE business_loyalty_settings ADD COLUMN receipt_printer_size TEXT DEFAULT '3inch'",
    "ALTER TABLE business_loyalty_settings ADD COLUMN pos_kiosk_pin TEXT DEFAULT '1234'",
    'ALTER TABLE business_loyalty_settings ADD COLUMN pos_kiosk_enabled INTEGER DEFAULT 1',
    'ALTER TABLE business_loyalty_settings ADD COLUMN pos_allow_credit INTEGER DEFAULT 1',
    "ALTER TABLE business_loyalty_settings ADD COLUMN pos_kiosk_config TEXT DEFAULT '{}'",
    'ALTER TABLE business_loyalty_settings ADD COLUMN point_value_currency REAL DEFAULT 1.0',
    'ALTER TABLE business_loyalty_settings ADD COLUMN min_order_spend REAL DEFAULT 0.0',
    'ALTER TABLE business_loyalty_settings ADD COLUMN min_points_to_redeem INTEGER DEFAULT 10',
    'ALTER TABLE business_loyalty_settings ADD COLUMN max_points_per_order INTEGER DEFAULT 5000',
    'ALTER TABLE business_loyalty_settings ADD COLUMN points_expiry_months INTEGER DEFAULT 0',
    'ALTER TABLE business_loyalty_settings ADD COLUMN welcome_bonus_points INTEGER DEFAULT 50',
    'ALTER TABLE business_loyalty_settings ADD COLUMN birthday_bonus_points INTEGER DEFAULT 100',
    'ALTER TABLE business_loyalty_settings ADD COLUMN enable_tiers INTEGER DEFAULT 1',
    'ALTER TABLE business_loyalty_settings ADD COLUMN tier_config TEXT DEFAULT NULL',
    'ALTER TABLE business_loyalty_settings ADD COLUMN exclude_tax_from_points INTEGER DEFAULT 1',
    'ALTER TABLE business_loyalty_settings ADD COLUMN round_down_points INTEGER DEFAULT 1',
    'ALTER TABLE business_loyalty_settings ADD COLUMN print_show_points_earned INTEGER DEFAULT 1',
    'ALTER TABLE business_loyalty_settings ADD COLUMN sms_notifications_enabled INTEGER DEFAULT 0',
    "ALTER TABLE business_loyalty_settings ADD COLUMN custom_program_name TEXT DEFAULT 'Cliks VIP Rewards'",
    'ALTER TABLE customer_loyalty_transactions ADD COLUMN customer_id INTEGER DEFAULT NULL',
    'ALTER TABLE customer_loyalty_transactions ADD COLUMN customer_name TEXT DEFAULT NULL',
    'ALTER TABLE customer_loyalty_transactions ADD COLUMN customer_phone TEXT DEFAULT NULL',
    "ALTER TABLE customer_loyalty_transactions ADD COLUMN transaction_type TEXT DEFAULT 'EARNED'",
    'ALTER TABLE customer_loyalty_transactions ADD COLUMN points INTEGER DEFAULT 0',
    'ALTER TABLE customer_loyalty_transactions ADD COLUMN balance_after INTEGER DEFAULT 0',
    'ALTER TABLE customer_loyalty_transactions ADD COLUMN notes TEXT DEFAULT NULL',
    'ALTER TABLE customer_loyalty_transactions ADD COLUMN merchant_user_id INTEGER DEFAULT NULL'
  ];

  for (const q of alters) {
    try { await db.prepare(q).run(); } catch (_) {}
  }
  ensureColumnsInit = true;
};
ensureLoyaltyColumns();

// Helper to determine customer's loyalty tier
const computeCustomerTier = (totalSpent = 0, tierList = DEFAULT_TIERS) => {
  const sorted = [...tierList].sort((a, b) => (b.min_spend || 0) - (a.min_spend || 0));
  for (const tier of sorted) {
    if (Number(totalSpent) >= Number(tier.min_spend || 0)) {
      return tier;
    }
  }
  return sorted[sorted.length - 1] || DEFAULT_TIERS[0];
};

// ── GET /api/v1/loyalty/program-settings ──────────────────────────────────────────
const getProgramSettings = async (req, res) => {
  try {
    await ensureLoyaltyColumns();
    const userId = req.user.id;
    let row = await db.prepare('SELECT * FROM business_loyalty_settings WHERE user_id = ?').get(userId);

    if (!row) {
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
      const printShowLoyalty = legacySettings.print_show_loyalty ? 1 : 0;
      const printShowCredit = legacySettings.print_show_credit ? 1 : 0;
      const printShowGst = legacySettings.print_show_gst !== undefined ? (legacySettings.print_show_gst ? 1 : 0) : 1;
      const receiptPrinterSize = legacySettings.receipt_printer_size || '3inch';
      const now = new Date().toISOString();

      try {
        await db.prepare(`
          INSERT INTO business_loyalty_settings (
            user_id, loyalty_enabled, rs_per_point, points_per_rs, max_claim_percent,
            print_show_loyalty, print_show_credit, print_show_gst, receipt_printer_size,
            point_value_currency, min_order_spend, min_points_to_redeem, max_points_per_order,
            points_expiry_months, welcome_bonus_points, birthday_bonus_points, enable_tiers,
            tier_config, exclude_tax_from_points, round_down_points, print_show_points_earned,
            sms_notifications_enabled, custom_program_name, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          userId, isEnabled, rsPer1Point, pointsPer1Rs, maxClaimPct,
          printShowLoyalty, printShowCredit, printShowGst, receiptPrinterSize,
          1.0, 0.0, 10, 5000, 0, 50, 100, 1, JSON.stringify(DEFAULT_TIERS), 1, 1, 1, 0, 'Cliks VIP Rewards', now, now
        );
      } catch (_) {}

      row = await db.prepare('SELECT * FROM business_loyalty_settings WHERE user_id = ?').get(userId);
    }

    let parsedTiers = DEFAULT_TIERS;
    try {
      if (row.tier_config) {
        parsedTiers = typeof row.tier_config === 'string' ? JSON.parse(row.tier_config) : row.tier_config;
      }
    } catch (_) {
      parsedTiers = DEFAULT_TIERS;
    }

    let parsedKioskConfig = {};
    try {
      if (row.pos_kiosk_config) {
        parsedKioskConfig = typeof row.pos_kiosk_config === 'string' ? JSON.parse(row.pos_kiosk_config) : row.pos_kiosk_config;
      }
    } catch (_) {}

    const loyaltyEnabled = Boolean(row.loyalty_enabled);

    return sendSuccess(res, {
      loyaltyEnabled: loyaltyEnabled,
      loyalty: loyaltyEnabled,
      customProgramName: row.custom_program_name || 'Cliks VIP Rewards',
      loyaltyRsPer1Point: Number(row.rs_per_point) || 100,
      pointsPerRs: Number(row.points_per_rs) || 100,
      pointValueCurrency: Number(row.point_value_currency !== undefined ? row.point_value_currency : 1.0),
      minOrderSpend: Number(row.min_order_spend || 0),
      minPointsToRedeem: Number(row.min_points_to_redeem !== undefined ? row.min_points_to_redeem : 10),
      loyaltyMaxClaimPercent: Number(row.max_claim_percent !== undefined ? row.max_claim_percent : 50),
      maxPointsPerOrder: Number(row.max_points_per_order || 5000),
      pointsExpiryMonths: Number(row.points_expiry_months || 0),
      welcomeBonusPoints: Number(row.welcome_bonus_points !== undefined ? row.welcome_bonus_points : 50),
      birthdayBonusPoints: Number(row.birthday_bonus_points !== undefined ? row.birthday_bonus_points : 100),
      enableTiers: row.enable_tiers !== undefined ? Boolean(row.enable_tiers) : true,
      tierConfig: parsedTiers,
      excludeTaxFromPoints: row.exclude_tax_from_points !== undefined ? Boolean(row.exclude_tax_from_points) : true,
      roundDownPoints: row.round_down_points !== undefined ? Boolean(row.round_down_points) : true,
      printShowLoyalty: Boolean(row.print_show_loyalty),
      print_show_loyalty: Boolean(row.print_show_loyalty),
      printShowPointsEarned: row.print_show_points_earned !== undefined ? Boolean(row.print_show_points_earned) : true,
      smsNotificationsEnabled: Boolean(row.sms_notifications_enabled),
      printShowCredit: Boolean(row.print_show_credit),
      printShowGst: row.print_show_gst !== undefined ? Boolean(row.print_show_gst) : true,
      receiptPrinterSize: row.receipt_printer_size || '3inch',
      posKioskPin: row.pos_kiosk_pin || '1234',
      posKioskEnabled: row.pos_kiosk_enabled !== undefined ? Boolean(row.pos_kiosk_enabled) : true,
      posAllowCredit: row.pos_allow_credit !== undefined ? Boolean(row.pos_allow_credit) : true,
      posKioskConfig: parsedKioskConfig,
      updatedAt: row.updated_at
    }, 'Loyalty program settings fetched');
  } catch (error) {
    console.error('[Loyalty Controller] Error fetching program settings:', error);
    return sendError(res, 'Failed to fetch loyalty program settings', 500);
  }
};

// ── PATCH/PUT /api/v1/loyalty/program-settings ────────────────────────────────────────
const updateProgramSettings = async (req, res) => {
  try {
    await ensureLoyaltyColumns();
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

    const programName = body.customProgramName !== undefined ? String(body.customProgramName).trim() : (existing?.custom_program_name || 'Cliks VIP Rewards');
    const rsPerPoint = body.loyaltyRsPer1Point !== undefined ? Number(body.loyaltyRsPer1Point) : (existing?.rs_per_point || 100);
    const pointValue = body.pointValueCurrency !== undefined ? Number(body.pointValueCurrency) : (existing?.point_value_currency !== undefined ? existing.point_value_currency : 1.0);
    const minSpend = body.minOrderSpend !== undefined ? Number(body.minOrderSpend) : (existing?.min_order_spend || 0);
    const minRedeem = body.minPointsToRedeem !== undefined ? Number(body.minPointsToRedeem) : (existing?.min_points_to_redeem || 10);
    const maxClaimPct = body.loyaltyMaxClaimPercent !== undefined ? Number(body.loyaltyMaxClaimPercent) : (existing?.max_claim_percent || 50);
    const maxPtsPerOrder = body.maxPointsPerOrder !== undefined ? Number(body.maxPointsPerOrder) : (existing?.max_points_per_order || 5000);
    const expiryMonths = body.pointsExpiryMonths !== undefined ? Number(body.pointsExpiryMonths) : (existing?.points_expiry_months || 0);
    const welcomeBonus = body.welcomeBonusPoints !== undefined ? Number(body.welcomeBonusPoints) : (existing?.welcome_bonus_points || 50);
    const birthdayBonus = body.birthdayBonusPoints !== undefined ? Number(body.birthdayBonusPoints) : (existing?.birthday_bonus_points || 100);
    const enableTiersVal = body.enableTiers !== undefined ? (body.enableTiers ? 1 : 0) : (existing?.enable_tiers !== undefined ? existing.enable_tiers : 1);
    
    let tierConfigJson = existing?.tier_config || JSON.stringify(DEFAULT_TIERS);
    if (body.tierConfig !== undefined) {
      tierConfigJson = typeof body.tierConfig === 'object' ? JSON.stringify(body.tierConfig) : String(body.tierConfig);
    }

    const excludeTaxVal = body.excludeTaxFromPoints !== undefined ? (body.excludeTaxFromPoints ? 1 : 0) : (existing?.exclude_tax_from_points !== undefined ? existing.exclude_tax_from_points : 1);
    const roundDownVal = body.roundDownPoints !== undefined ? (body.roundDownPoints ? 1 : 0) : (existing?.round_down_points !== undefined ? existing.round_down_points : 1);
    const printLoyaltyVal = (body.printShowLoyalty !== undefined || body.print_show_loyalty !== undefined)
      ? ((body.printShowLoyalty ?? body.print_show_loyalty) ? 1 : 0)
      : (existing?.print_show_loyalty || 0);
    const printPtsEarnedVal = body.printShowPointsEarned !== undefined ? (body.printShowPointsEarned ? 1 : 0) : (existing?.print_show_points_earned !== undefined ? existing.print_show_points_earned : 1);
    const smsNotifVal = body.smsNotificationsEnabled !== undefined ? (body.smsNotificationsEnabled ? 1 : 0) : (existing?.sms_notifications_enabled || 0);

    if (existing) {
      await db.prepare(`
        UPDATE business_loyalty_settings SET
          loyalty_enabled = ?, custom_program_name = ?, rs_per_point = ?, point_value_currency = ?,
          min_order_spend = ?, min_points_to_redeem = ?, max_claim_percent = ?, max_points_per_order = ?,
          points_expiry_months = ?, welcome_bonus_points = ?, birthday_bonus_points = ?, enable_tiers = ?,
          tier_config = ?, exclude_tax_from_points = ?, round_down_points = ?, print_show_loyalty = ?,
          print_show_points_earned = ?, sms_notifications_enabled = ?, updated_at = ?
        WHERE user_id = ?
      `).run(
        enabledVal, programName, rsPerPoint, pointValue,
        minSpend, minRedeem, maxClaimPct, maxPtsPerOrder,
        expiryMonths, welcomeBonus, birthdayBonus, enableTiersVal,
        tierConfigJson, excludeTaxVal, roundDownVal, printLoyaltyVal,
        printPtsEarnedVal, smsNotifVal, now, userId
      );
    } else {
      await db.prepare(`
        INSERT INTO business_loyalty_settings (
          user_id, loyalty_enabled, custom_program_name, rs_per_point, point_value_currency,
          min_order_spend, min_points_to_redeem, max_claim_percent, max_points_per_order,
          points_expiry_months, welcome_bonus_points, birthday_bonus_points, enable_tiers,
          tier_config, exclude_tax_from_points, round_down_points, print_show_loyalty,
          print_show_points_earned, sms_notifications_enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId, enabledVal, programName, rsPerPoint, pointValue,
        minSpend, minRedeem, maxClaimPct, maxPtsPerOrder,
        expiryMonths, welcomeBonus, birthdayBonus, enableTiersVal,
        tierConfigJson, excludeTaxVal, roundDownVal, printLoyaltyVal,
        printPtsEarnedVal, smsNotifVal, now, now
      );
    }

    // Keep users.settings in sync
    try {
      const u = await db.prepare('SELECT settings FROM users WHERE id = ?').get(userId);
      let s = {};
      if (u && u.settings) {
        try { s = JSON.parse(u.settings); } catch (_) {}
      }
      s.loyaltyEnabled = Boolean(enabledVal);
      s.loyalty = Boolean(enabledVal);
      s.loyaltyRsPer1Point = rsPerPoint;
      s.loyaltyMaxClaimPercent = maxClaimPct;
      s.print_show_loyalty = Boolean(printLoyaltyVal);
      await db.prepare('UPDATE users SET settings = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(s), now, userId);
    } catch (_) {}

    return getProgramSettings(req, res);
  } catch (error) {
    console.error('[Loyalty Controller] Error updating program settings:', error);
    return sendError(res, 'Failed to update loyalty program settings', 500);
  }
};

// ── GET /api/v1/loyalty/stats ─────────────────────────────────────────────────────
const getLoyaltyStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const settings = await db.prepare('SELECT * FROM business_loyalty_settings WHERE user_id = ?').get(userId);
    const pointValue = Number(settings?.point_value_currency !== undefined ? settings.point_value_currency : 1.0);

    // Sum from business_customers
    const custAgg = await db.prepare(`
      SELECT 
        COUNT(*) as total_customers,
        COUNT(CASE WHEN loyalty_points > 0 THEN 1 END) as active_members,
        COALESCE(SUM(loyalty_points), 0) as outstanding_points,
        COALESCE(SUM(total_spent), 0) as total_revenue
      FROM business_customers
      WHERE user_id = ?
    `).get(userId);

    // Points earned & redeemed from purchase history or transactions
    const historyAgg = await db.prepare(`
      SELECT 
        COALESCE(SUM(points_earned), 0) as total_issued,
        COALESCE(SUM(points_redeemed), 0) as total_redeemed
      FROM customer_purchase_history
      WHERE merchant_business_id = ?
    `).get(userId);

    const totalIssued = Number(historyAgg?.total_issued || 0) + Number(custAgg?.outstanding_points || 0);
    const totalRedeemed = Number(historyAgg?.total_redeemed || 0);
    const outstandingPoints = Number(custAgg?.outstanding_points || 0);
    const liabilityValue = outstandingPoints * pointValue;

    return sendSuccess(res, {
      activeProgram: Boolean(settings?.loyalty_enabled),
      programName: settings?.custom_program_name || 'Cliks VIP Rewards',
      pointValueCurrency: pointValue,
      totalMembers: Number(custAgg?.active_members || 0),
      totalCustomers: Number(custAgg?.total_customers || 0),
      totalPointsIssued: totalIssued,
      totalPointsRedeemed: totalRedeemed,
      outstandingPoints: outstandingPoints,
      liabilityValue: liabilityValue,
      totalRevenue: Number(custAgg?.total_revenue || 0)
    }, 'Loyalty program statistics fetched');
  } catch (error) {
    console.error('[Loyalty Controller] Error fetching loyalty stats:', error);
    return sendError(res, 'Failed to fetch loyalty statistics', 500);
  }
};

// ── GET /api/v1/loyalty/customers ─────────────────────────────────────────────────
const getLoyaltyCustomers = async (req, res) => {
  try {
    const userId = req.user.id;
    const { search, tier } = req.query;

    const settings = await db.prepare('SELECT * FROM business_loyalty_settings WHERE user_id = ?').get(userId);
    const pointValue = Number(settings?.point_value_currency !== undefined ? settings.point_value_currency : 1.0);
    
    let tierConfig = DEFAULT_TIERS;
    try {
      if (settings?.tier_config) {
        tierConfig = typeof settings.tier_config === 'string' ? JSON.parse(settings.tier_config) : settings.tier_config;
      }
    } catch (_) {}

    let query = 'SELECT id, name, email, phone, phone_number, loyalty_points, total_spent, created_at, updated_at FROM business_customers WHERE user_id = ?';
    const params = [userId];

    if (search && String(search).trim()) {
      const q = `%${String(search).trim().toLowerCase()}%`;
      query += ' AND (LOWER(name) LIKE ? OR LOWER(email) LIKE ? OR phone LIKE ? OR phone_number LIKE ?)';
      params.push(q, q, q, q);
    }

    query += ' ORDER BY loyalty_points DESC, updated_at DESC';
    const rows = await db.prepare(query).all(...params);

    const customers = rows.map(c => {
      const pts = Number(c.loyalty_points || 0);
      const spent = Number(c.total_spent || 0);
      const assignedTier = computeCustomerTier(spent, tierConfig);

      return {
        id: c.id,
        name: c.name || 'Unnamed Customer',
        email: c.email || '',
        phone: c.phone || c.phone_number || '',
        loyalty_points: pts,
        total_spent: spent,
        tier: assignedTier,
        points_currency_value: pts * pointValue,
        joined_at: c.created_at
      };
    });

    const filtered = tier && tier !== 'all' 
      ? customers.filter(c => c.tier.id.toLowerCase() === tier.toLowerCase())
      : customers;

    return sendSuccess(res, {
      customers: filtered,
      totalCount: filtered.length
    }, 'Loyalty customers fetched successfully');
  } catch (error) {
    console.error('[Loyalty Controller] Error fetching loyalty customers:', error);
    return sendError(res, 'Failed to fetch loyalty customers', 500);
  }
};

// ── POST /api/v1/loyalty/customers/:customerId/adjust ─────────────────────────────
const adjustCustomerPoints = async (req, res) => {
  try {
    const userId = req.user.id;
    const { customerId } = req.params;
    const { action, points, reason, notes } = req.body || {};

    const pts = Math.abs(parseInt(points, 10));
    if (!pts || isNaN(pts) || pts <= 0) {
      return sendError(res, 'Points amount must be a positive number', 400);
    }

    const customer = await db.prepare('SELECT * FROM business_customers WHERE id = ? AND user_id = ?').get(customerId, userId);
    if (!customer) {
      return sendError(res, 'Customer not found', 404);
    }

    const currentPts = Number(customer.loyalty_points || 0);
    let newBalance = currentPts;
    const actionType = String(action).toUpperCase() === 'DEBIT' ? 'MANUAL_DEBIT' : 'MANUAL_CREDIT';

    if (actionType === 'MANUAL_DEBIT') {
      if (pts > currentPts) {
        return sendError(res, `Cannot deduct ${pts} points. Customer only has ${currentPts} points available.`, 400);
      }
      newBalance = currentPts - pts;
    } else {
      newBalance = currentPts + pts;
    }

    const now = new Date().toISOString();
    await db.prepare('UPDATE business_customers SET loyalty_points = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .run(newBalance, now, customerId, userId);

    // Record in transactions ledger
    const noteText = notes || reason || (actionType === 'MANUAL_CREDIT' ? 'Manual loyalty points credit' : 'Manual loyalty points deduction');
    await db.prepare(`
      INSERT INTO customer_loyalty_transactions (
        user_id, merchant_user_id, customer_id, customer_name, customer_phone,
        transaction_type, points, balance_after, points_earned, points_redeemed,
        description, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId, userId, customerId, customer.name, customer.phone || customer.phone_number,
      actionType, actionType === 'MANUAL_CREDIT' ? pts : -pts, newBalance,
      actionType === 'MANUAL_CREDIT' ? pts : 0, actionType === 'MANUAL_DEBIT' ? pts : 0,
      noteText, noteText, now
    );

    return sendSuccess(res, {
      customerId: customer.id,
      customerName: customer.name,
      previousBalance: currentPts,
      newBalance: newBalance,
      delta: actionType === 'MANUAL_CREDIT' ? pts : -pts,
      action: actionType
    }, 'Loyalty points adjusted successfully');
  } catch (error) {
    console.error('[Loyalty Controller] Error adjusting loyalty points:', error);
    return sendError(res, 'Failed to adjust loyalty points', 500);
  }
};

// ── GET /api/v1/loyalty/transactions ──────────────────────────────────────────────
const getLoyaltyTransactions = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 50 } = req.query;

    const rows = await db.prepare(`
      SELECT * FROM customer_loyalty_transactions 
      WHERE (merchant_user_id = ? OR user_id = ?)
      ORDER BY id DESC 
      LIMIT ?
    `).all(userId, userId, Number(limit) || 50);

    return sendSuccess(res, rows, 'Loyalty transactions ledger fetched');
  } catch (error) {
    console.error('[Loyalty Controller] Error fetching loyalty transactions:', error);
    return sendError(res, 'Failed to fetch loyalty transactions', 500);
  }
};

module.exports = {
  getProgramSettings,
  updateProgramSettings,
  getLoyaltyStats,
  getLoyaltyCustomers,
  adjustCustomerPoints,
  getLoyaltyTransactions,
  DEFAULT_TIERS
};
