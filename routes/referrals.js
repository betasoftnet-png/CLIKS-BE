const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { getReferrals } = require('../controllers/referralsController');

// GET /referrals — List referrals for current authenticated user
router.get('/', auth, asyncHandler(getReferrals));

module.exports = router;
