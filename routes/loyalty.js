const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { getProgramSettings, updateProgramSettings } = require('../controllers/loyaltyController');

// GET   /api/v1/loyalty/program-settings — Get loyalty settings for the merchant
router.get('/program-settings', auth, getProgramSettings);
router.get('/settings', auth, getProgramSettings);

// PATCH /api/v1/loyalty/program-settings — Update loyalty settings for the merchant
router.patch('/program-settings', auth, updateProgramSettings);
router.patch('/settings', auth, updateProgramSettings);
router.put('/program-settings', auth, updateProgramSettings);
router.put('/settings', auth, updateProgramSettings);

module.exports = router;
