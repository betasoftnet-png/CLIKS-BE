/**
 * middleware/rateLimiter.js
 *
 * Three tiered limiters:
 *  - `authLimiter`    — strict (10 req / 15 min) for login / register
 *  - `likeLimiter`    — moderate (30 req / 1 min) for the public like endpoint
 *  - `globalLimiter`  — lenient  (300 req / 1 min) applied to the entire API
 */

const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many auth attempts. Please try again in 15 minutes.'
    }
  }
});

const likeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many like requests. Please slow down.'
    }
  }
});

const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 1200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Rate limit exceeded. Please slow down.'
    }
  }
});

module.exports = { authLimiter, likeLimiter, globalLimiter };
