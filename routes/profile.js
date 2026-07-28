const express = require('express');
const router = express.Router();
const { getProfile, updateProfile, changePassword, getSubscriptionDetails } = require('../controllers/profileController');

// GET    /profile/subscription/:email - Get subscription details
router.get('/subscription/:email', getSubscriptionDetails);

// GET    /profile                    — Get the currently authenticated user's profile
router.get('/', getProfile);

// PATCH  /profile                    — Update username or email
router.patch('/', updateProfile);

// PATCH  /profile/change-password    — Change the user's password (requires current password)
router.patch('/change-password', changePassword);

module.exports = router;
