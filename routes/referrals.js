const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { getReferrals } = require('../controllers/referralsController');

// Optional authentication middleware: if Authorization header is provided, decode user; else continue
const optionalAuth = (req, res, next) => {
  if (req.headers.authorization) {
    return auth(req, res, next);
  }
  next();
};

// GET /referrals, GET /referrals/my-referrals, GET /api/referrals/my-referrals
router.get('/', optionalAuth, asyncHandler(getReferrals));
router.get('/my-referrals', optionalAuth, asyncHandler(getReferrals));
router.get('/history', optionalAuth, asyncHandler(getReferrals));

module.exports = router;
