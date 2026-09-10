const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const pitchController = require('../controllers/pitchController');

// Apply auth to all endpoints for integrity
router.get('/', auth, pitchController.getPitches);
router.post('/', auth, pitchController.createPitch);
router.post('/:id/verify', auth, pitchController.verifyPitch);

module.exports = router;
