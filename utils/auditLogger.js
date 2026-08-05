const db = require('../db/connection');

/**
 * Records an immutable audit event into the relational database.
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

/**
 * Enhanced Phase 5 Audit Logger recording full context:
 * User ID, Role, Action, Module, Record ID, Old Value, New Value, IP Address, Browser, Timestamp.
 */
const logAuditEvent = async (req, { action, module, recordId, oldValue, newValue, details }) => {
  try {
    const userId = req?.user?.id || null;
    const role = req?.user?.role || 'User';
    const actorName = req?.user?.username || req?.user?.email || `User #${userId || 'Guest'}`;
    const ipAddress = req?.ip || req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || '127.0.0.1';
    const browser = req?.headers?.['user-agent'] || 'Unknown';
    const now = new Date().toISOString();

    const oldStr = typeof oldValue === 'object' ? JSON.stringify(oldValue) : (oldValue ? String(oldValue) : null);
    const newStr = typeof newValue === 'object' ? JSON.stringify(newValue) : (newValue ? String(newValue) : null);
    const msg = details || `${action} on ${module}${recordId ? ' ID: ' + recordId : ''} by ${actorName}`;

    await db.prepare(`
      INSERT INTO audit_logs (user_id, role, action, module, record_id, old_value, new_value, ip_address, browser, action_type, message, actor, severity, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INFO', ?)
    `).run(
      userId,
      role,
      action,
      module,
      recordId ? String(recordId) : null,
      oldStr,
      newStr,
      ipAddress,
      browser,
      action,
      msg,
      actorName,
      now
    );
  } catch (err) {
    console.warn(`⚠️ [Audit Logging Error]`, err.message);
  }
};

module.exports = { recordAudit, logAuditEvent };
