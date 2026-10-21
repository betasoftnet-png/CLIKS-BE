const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

let ensureColumnsInit = false;
const ensureLoyaltyColumns = async () => {
  if (ensureColumnsInit) return;
  try {
    await db.prepare('ALTER TABLE business_loyalty_settings ADD COLUMN print_show_loyalty INTEGER DEFAULT 0').run();
  } catch (e) {}
  try {
    await db.prepare('ALTER TABLE business_loyalty_settings ADD COLUMN print_show_credit INTEGER DEFAULT 0').run();
  } catch (e) {}
  try {
    await db.prepare('ALTER TABLE business_loyalty_settings ADD COLUMN print_show_gst INTEGER DEFAULT 1').run();
  } catch (e) {}
  try {
    await db.prepare("ALTER TABLE business_loyalty_settings ADD COLUMN receipt_printer_size TEXT DEFAULT '3inch'").run();
  } catch (e) {}
  try {
    await db.prepare("ALTER TABLE business_loyalty_settings ADD COLUMN pos_kiosk_pin TEXT DEFAULT '1234'").run();
  } catch (e) {}
  try {
    await db.prepare('ALTER TABLE business_loyalty_settings ADD COLUMN pos_kiosk_enabled INTEGER DEFAULT 1').run();
  } catch (e) {}
  try {
    await db.prepare('ALTER TABLE business_loyalty_settings ADD COLUMN pos_allow_credit INTEGER DEFAULT 1').run();
  } catch (e) {}
  ensureColumnsInit = true;
};
ensureLoyaltyColumns();

// ── GET /api/v1/loyalty/program-settings ──────────────────────────────────────────
const getProgramSettings = async (req, res) => {
  try {
    await ensureLoyaltyColumns();
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
      const printShowLoyalty = legacySettings.print_show_loyalty !== undefined ? (legacySettings.print_show_loyalty ? 1 : 0) : 0;
      const printShowCredit = legacySettings.print_show_credit !== undefined ? (legacySettings.print_show_credit ? 1 : 0) : 0;
      const printShowGst = legacySettings.print_show_gst !== undefined ? (legacySettings.print_show_gst ? 1 : 0) : 1;
      const receiptPrinterSize = legacySettings.receipt_printer_size || legacySettings.receiptPrinterSize || '3inch';
      const posKioskPin = legacySettings.pos_kiosk_pin || legacySettings.posKioskPin || '1234';
      const posKioskEnabled = legacySettings.pos_kiosk_enabled !== undefined ? (legacySettings.pos_kiosk_enabled ? 1 : 0) : 1;
      const posAllowCredit = legacySettings.pos_allow_credit !== undefined ? (legacySettings.pos_allow_credit ? 1 : 0) : 1;

      const now = new Date().toISOString();
      try {
        await db.prepare(`
          INSERT INTO business_loyalty_settings (user_id, loyalty_enabled, rs_per_point, points_per_rs, max_claim_percent, print_show_loyalty, print_show_credit, print_show_gst, receipt_printer_size, pos_kiosk_pin, pos_kiosk_enabled, pos_allow_credit, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(userId, isEnabled, rsPer1Point, pointsPer1Rs, maxClaimPct, printShowLoyalty, printShowCredit, printShowGst, receiptPrinterSize, posKioskPin, posKioskEnabled, posAllowCredit, now, now);
      } catch (insertErr) {
        // Ignored if race condition inserted it
      }

      row = {
        user_id: userId,
        loyalty_enabled: isEnabled,
        rs_per_point: rsPer1Point,
        points_per_rs: pointsPer1Rs,
        max_claim_percent: maxClaimPct,
        print_show_loyalty: printShowLoyalty,
        print_show_credit: printShowCredit,
        print_show_gst: printShowGst,
        receipt_printer_size: receiptPrinterSize,
        pos_kiosk_pin: posKioskPin,
        pos_kiosk_enabled: posKioskEnabled,
        pos_allow_credit: posAllowCredit,
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
      printShowLoyalty: Boolean(row.print_show_loyalty),
      print_show_loyalty: Boolean(row.print_show_loyalty),
      printShowCredit: Boolean(row.print_show_credit),
      print_show_credit: Boolean(row.print_show_credit),
      printShowGst: row.print_show_gst !== undefined ? Boolean(row.print_show_gst) : true,
      print_show_gst: row.print_show_gst !== undefined ? Boolean(row.print_show_gst) : true,
      receiptPrinterSize: row.receipt_printer_size || '3inch',
      receipt_printer_size: row.receipt_printer_size || '3inch',
      posKioskPin: row.pos_kiosk_pin || '1234',
      pos_kiosk_pin: row.pos_kiosk_pin || '1234',
      posKioskEnabled: row.pos_kiosk_enabled !== undefined ? Boolean(row.pos_kiosk_enabled) : true,
      pos_kiosk_enabled: row.pos_kiosk_enabled !== undefined ? Boolean(row.pos_kiosk_enabled) : true,
      posAllowCredit: row.pos_allow_credit !== undefined ? Boolean(row.pos_allow_credit) : true,
      pos_allow_credit: row.pos_allow_credit !== undefined ? Boolean(row.pos_allow_credit) : true,
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

    const rsPerPoint = body.loyaltyRsPer1Point !== undefined 
      ? Number(body.loyaltyRsPer1Point) 
      : (existing ? existing.rs_per_point : 100);

    const pointsPerRs = body.loyaltyPointsPer1Rs !== undefined 
      ? Number(body.loyaltyPointsPer1Rs) 
      : (existing ? existing.points_per_rs : 100);

    const maxClaimPct = body.loyaltyMaxClaimPercent !== undefined 
      ? Number(body.loyaltyMaxClaimPercent) 
      : (existing ? existing.max_claim_percent : 50);

    const printShowLoyaltyVal = (body.printShowLoyalty !== undefined || body.print_show_loyalty !== undefined)
      ? ((body.printShowLoyalty ?? body.print_show_loyalty) ? 1 : 0)
      : (existing ? (existing.print_show_loyalty || 0) : 0);

    const printShowCreditVal = (body.printShowCredit !== undefined || body.print_show_credit !== undefined)
      ? ((body.printShowCredit ?? body.print_show_credit) ? 1 : 0)
      : (existing ? (existing.print_show_credit || 0) : 0);

    const printShowGstVal = (body.printShowGst !== undefined || body.print_show_gst !== undefined)
      ? ((body.printShowGst ?? body.print_show_gst) ? 1 : 0)
      : (existing && existing.print_show_gst !== undefined ? existing.print_show_gst : 1);

    const receiptPrinterSizeVal = String(body.receiptPrinterSize || body.receipt_printer_size || (existing ? existing.receipt_printer_size : '3inch') || '3inch').toLowerCase();

    const posKioskPinVal = String(body.posKioskPin || body.pos_kiosk_pin || (existing ? existing.pos_kiosk_pin : '1234') || '1234');

    const posKioskEnabledVal = (body.posKioskEnabled !== undefined || body.pos_kiosk_enabled !== undefined)
      ? ((body.posKioskEnabled ?? body.pos_kiosk_enabled) ? 1 : 0)
      : (existing && existing.pos_kiosk_enabled !== undefined ? existing.pos_kiosk_enabled : 1);

    const posAllowCreditVal = (body.posAllowCredit !== undefined || body.pos_allow_credit !== undefined)
      ? ((body.posAllowCredit ?? body.pos_allow_credit) ? 1 : 0)
      : (existing && existing.pos_allow_credit !== undefined ? existing.pos_allow_credit : 1);

    if (existing) {
      await db.prepare(`
        UPDATE business_loyalty_settings 
        SET loyalty_enabled = ?, rs_per_point = ?, points_per_rs = ?, max_claim_percent = ?, print_show_loyalty = ?, print_show_credit = ?, print_show_gst = ?, receipt_printer_size = ?, pos_kiosk_pin = ?, pos_kiosk_enabled = ?, pos_allow_credit = ?, updated_at = ?
        WHERE user_id = ?
      `).run(enabledVal, rsPerPoint, pointsPerRs, maxClaimPct, printShowLoyaltyVal, printShowCreditVal, printShowGstVal, receiptPrinterSizeVal, posKioskPinVal, posKioskEnabledVal, posAllowCreditVal, now, userId);
    } else {
      await db.prepare(`
        INSERT INTO business_loyalty_settings (user_id, loyalty_enabled, rs_per_point, points_per_rs, max_claim_percent, print_show_loyalty, print_show_credit, print_show_gst, receipt_printer_size, pos_kiosk_pin, pos_kiosk_enabled, pos_allow_credit, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, enabledVal, rsPerPoint, pointsPerRs, maxClaimPct, printShowLoyaltyVal, printShowCreditVal, printShowGstVal, receiptPrinterSizeVal, posKioskPinVal, posKioskEnabledVal, posAllowCreditVal, now, now);
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
      s.print_show_loyalty = Boolean(printShowLoyaltyVal);
      s.printShowLoyalty = Boolean(printShowLoyaltyVal);
      s.print_show_credit = Boolean(printShowCreditVal);
      s.printShowCredit = Boolean(printShowCreditVal);
      s.print_show_gst = Boolean(printShowGstVal);
      s.printShowGst = Boolean(printShowGstVal);
      s.receipt_printer_size = receiptPrinterSizeVal;
      s.receiptPrinterSize = receiptPrinterSizeVal;
      s.pos_kiosk_pin = posKioskPinVal;
      s.posKioskPin = posKioskPinVal;
      s.pos_kiosk_enabled = Boolean(posKioskEnabledVal);
      s.posKioskEnabled = Boolean(posKioskEnabledVal);
      s.pos_allow_credit = Boolean(posAllowCreditVal);
      s.posAllowCredit = Boolean(posAllowCreditVal);
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
      printShowLoyalty: Boolean(printShowLoyaltyVal),
      print_show_loyalty: Boolean(printShowLoyaltyVal),
      printShowCredit: Boolean(printShowCreditVal),
      print_show_credit: Boolean(printShowCreditVal),
      printShowGst: Boolean(printShowGstVal),
      print_show_gst: Boolean(printShowGstVal),
      receiptPrinterSize: receiptPrinterSizeVal,
      receipt_printer_size: receiptPrinterSizeVal,
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
