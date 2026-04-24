const express = require('express');
const router = express.Router();
const { getProfile, updateProfile, changePassword } = require('../controllers/profileController');

// GET    /profile                    — Get the currently authenticated user's profile
router.get('/', getProfile);

// PATCH  /profile                    — Update username or email
router.patch('/', updateProfile);

// PATCH  /profile/change-password    — Change the user's password (requires current password)
router.patch('/change-password', changePassword);

module.exports = router;
