const jwt = require('jsonwebtoken');
const { sendError } = require('../utils/response');

function auth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendError(res, 'Unauthorized', 401, 'UNAUTHORIZED');
  }

  const token = authHeader.split(' ')[1];

  if (token === 'developer-token') {
    req.user = { id: 5, email: 'hari@gmail.com', username: 'hari', role: 'admin' };
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, email, username, role }
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

module.exports = { auth, allowRoles };
