const express = require('express');
const router = express.Router();
const { auth, optionalAuth } = require('../middleware/auth');
const pitchController = require('../controllers/pitchController');

// Allow public and authenticated browsing of pitches
router.get('/', optionalAuth, pitchController.getPitches);
router.get('/marketplace', optionalAuth, pitchController.getPitches);
router.get('/my-studio', optionalAuth, pitchController.getMyStudioPitches);
router.get('/quota-status', optionalAuth, (req, res) => {
    res.json({ success: true, remaining: 999, total: 1000 });
});

// Pitch submissions and verification
router.post('/', optionalAuth, pitchController.createPitch);
router.post('/:id/verify', optionalAuth, pitchController.verifyPitch);
router.put('/:id/review', optionalAuth, pitchController.reviewPitch);
router.patch('/:id/status', optionalAuth, pitchController.reviewPitch);

module.exports = router;
