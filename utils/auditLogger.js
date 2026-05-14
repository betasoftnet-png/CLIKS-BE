const db = require('../db/connection');

/**
 * Records an immutable audit event into the relational database.
 * Designed to catch and suppress failures to ensure core transaction logic is never blocked by logging outages.
 * 
 * @param {string} actionType e.g. 'SETTINGS_UPDATE', 'BROADCAST_DEPLOY', 'AUTH_LOGIN', 'ROLE_CHANGE', 'INTEGRITY_DIAGNOSTIC'
 * @param {string} message The human-readable narrative tracking exactly what occurred.
 * @param {string} actor The identifier (username or node ID) that initiated the event.
 * @param {string} severity 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR'
 */
const recordAudit = async (actionType, message, actor = 'System', severity = 'INFO') => {
  try {
    await db.prepare(`
      INSERT INTO audit_logs (action_type, message, actor, severity, created_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run([actionType, message, actor, severity]);
  } catch (err) {
    console.warn(`⚠️ [Audit Logging Interrupted] Failed to persist "${actionType}" record:`, err.message);
  }
};

module.exports = { recordAudit };
