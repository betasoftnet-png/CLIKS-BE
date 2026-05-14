const jwt = require('jsonwebtoken');
const db = require('../db/connection');

async function checkSystemMaintenance(req, res, next) {
  try {
    // 1. Define bypass routes (Admins must be able to access admin panels to turn maintenance off!)
    const bypassPrefixes = [
      '/api/v1/admin',
      '/api/v1/auth',
      '/api/v1/public',
      '/api/v1/sales-agent',
      '/api-docs'
    ];

    const isBypassed = bypassPrefixes.some(prefix => req.originalUrl.startsWith(prefix)) || req.originalUrl.startsWith('/api/v1/health');
    if (isBypassed) {
      return next();
    }

    // 2. Query global config table for active maintenance state
    const maintenanceRecord = await db.prepare("SELECT value FROM platform_config WHERE key = 'maintenance_mode'").get();
    const isMaintenanceActive = maintenanceRecord?.value === 'true';

    if (!isMaintenanceActive) {
      return next();
    }

    // 3. If Maintenance is ARMED, extract and verify Bearer token to allow Platform Admins through
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        // If standard SuperAdmin claim is active, let them pass to debug client views
        if (decoded.role === 'admin') {
          return next();
        }
      } catch (err) {
        // Let invalid tokens fall through to block screen
      }
    }

    // 4. Throw Service Unavailable Outage Header
    return res.status(503).json({
      success: false,
      status: 'maintenance',
      error: {
        code: 'SYSTEM_UNDER_MAINTENANCE',
        message: 'CLIKS is undergoing scheduled infrastructure scaling or database reconciliation. Normal service will resume shortly.'
      }
    });

  } catch (err) {
    // If DB fails to read maintenance config, fail open to ensure standard availability
    console.error("Maintenance middleware runtime bypass error:", err.message);
    next();
  }
}

module.exports = { checkSystemMaintenance };
