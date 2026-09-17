const express = require('express');
const router = express.Router();
const { optionalAuth, auth } = require('../middleware/auth');
const pitchController = require('../controllers/pitchController');

// Allow fetching and listing venture pitches with central PostgreSQL persistence
router.get('/', optionalAuth, pitchController.getPitches);
router.get('/pitches', optionalAuth, pitchController.getPitches);
router.post('/', optionalAuth, pitchController.createPitch);
router.post('/pitches', optionalAuth, pitchController.createPitch);
router.post('/:id/verify', auth, pitchController.verifyPitch);

module.exports = router;
