const express = require('express');
const router = express.Router();
const { getSettings, updateSettings, replaceSettings } = require('../controllers/settingsController');

// GET   /settings       — Fetch the current user's settings object
router.get('/', getSettings);

// PATCH /settings       — Deep-merge incoming changes into existing settings
router.patch('/', updateSettings);

// PUT   /settings       — Fully replace the user's settings object
router.put('/', replaceSettings);

module.exports = router;
