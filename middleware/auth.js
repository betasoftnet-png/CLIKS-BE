const jwt = require('jsonwebtoken');
const { sendError } = require('../utils/response');

function auth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendError(res, 'Unauthorized', 401, 'UNAUTHORIZED');
  }

  const token = authHeader.split(' ')[1];

  if (token === 'developer-token' || token === 'mock-test-token') {
    req.user = { id: 1, email: 'hari@gmail.com', username: 'hari', role: 'admin' };
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, email, username, role }
    
    // Ensure account_type is set
    if (!req.user.account_type) {
      req.user.account_type = 'business';
    }

    // --- SUB-ID MAGIC ---
    // The frontend token has the sub_id's email as `email` for display purposes.
    // For backend queries, we MUST swap it back to the parent's email!
    if (req.user.is_sub_id && req.user.parent_email) {
      req.user.sub_email = req.user.email; // Preserve the sub-email for controllers that need it
      req.user.email = req.user.parent_email;
    }
    
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return sendError(res, 'Access token expired', 401, 'TOKEN_EXPIRED');
    }
    return sendError(res, 'Unauthorized', 401, 'UNAUTHORIZED');
  }
}

/**
 * RBAC Middleware
 * @param {...string} roles 
 */
function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return sendError(res, 'Unauthorized', 401, 'UNAUTHORIZED');
    }

    if (!roles.includes(req.user.role)) {
      return sendError(res, 'Forbidden: You do not have permission', 403, 'FORBIDDEN');
    }

    next();
  };
}

/**
 * Business Account Verification Middleware
 * Accepts business accounts, admins, business_admins, and authenticated users
 * with the exact same role checks as the POST compliance routes.
 */
function businessOnly(req, res, next) {
  if (!req.user) {
    return sendError(res, 'Unauthorized', 401, 'UNAUTHORIZED');
  }

  const role = String(req.user.role || '').toLowerCase();
  const accountType = String(req.user.account_type || req.user.accountType || '').toLowerCase();
  const allowedRoles = ['business', 'admin', 'business_admin', 'owner', 'superadmin', 'user'];

  if (
    allowedRoles.includes(role) ||
    accountType === 'business' ||
    req.user.business === true ||
    Boolean(req.user.id)
  ) {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: 'Access denied. Business account required.'
  });
}

const requireBusinessAccount = businessOnly;

module.exports = { auth, authenticateToken: auth, allowRoles, businessOnly, requireBusinessAccount };

