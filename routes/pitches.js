const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const pitchController = require('../controllers/pitchController');

// Apply auth to all endpoints for integrity
router.get('/marketplace', auth, pitchController.getMarketplacePitches);
router.get('/my-studio', auth, pitchController.getMyStudioPitches);
router.get('/quota-status', auth, pitchController.getQuotaStatus);
router.get('/', auth, pitchController.getPitches);
router.post('/', auth, pitchController.createPitch);
router.put('/:id/resubmit', auth, pitchController.resubmitPitch);
router.post('/:id/unlock', auth, pitchController.unlockPitch);
router.post('/:id/verify', auth, pitchController.verifyPitch);

module.exports = router;
