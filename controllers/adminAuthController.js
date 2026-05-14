const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/connection');
const { sendSuccess } = require('../utils/response');
const AppError = require('../utils/AppError');

const { recordAudit } = require('../utils/auditLogger');

/**
 * Platform Admin Core Authentication
 */
const adminLogin = async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    throw new AppError('Administrative coordinates (email & password) required.', 400, 'BAD_REQUEST');
  }

  // Target the ISOLATED 'platform_admins' table exclusively
  const admin = await db.prepare('SELECT * FROM platform_admins WHERE email = ?').get(email);
  
  if (!admin) {
    throw new AppError('Access Violation: Identity mismatch. Access restricted.', 401, 'UNAUTHORIZED');
  }

  // Perform standard bcrypt validation
  const isMatch = await bcrypt.compare(password, admin.password_hash);
  if (!isMatch) {
    throw new AppError('Access Violation: Secure token validation failed.', 401, 'UNAUTHORIZED');
  }

  // Issue clean standalone session token
  const payload = {
    id: admin.id,
    username: admin.name || 'Master Admin',
    email: admin.email,
    role: 'admin', // Vital for platform API RBAC routing middleware
    isPlatformCore: true
  };

  const accessToken = jwt.sign(
    payload, 
    process.env.JWT_SECRET, 
    { expiresIn: '24h' }
  );

  const safeAdmin = {
    id: admin.id,
    name: admin.name || 'Master Admin',
    email: admin.email,
    role: 'admin'
  };

  await recordAudit('ADMIN_LOGIN', `Administrative terminal initialized by "${admin.name || 'Master Admin'}"`, admin.name || 'Master Admin', 'SUCCESS');

  return sendSuccess(
    res, 
    { accessToken, user: safeAdmin }, 
    'Platform Command Authorization Granted.', 
    200
  );
};

module.exports = { adminLogin };
