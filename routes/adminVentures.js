const express = require('express');
const router = express.Router();
const adminVenturesController = require('../controllers/adminVenturesController');
const { auth } = require('../middleware/auth');

// Protect admin routes with auth middleware
router.use(auth);

router.get('/pitches', adminVenturesController.getAllPitches);
router.put('/pitches/:id/review', adminVenturesController.reviewPitch);

module.exports = router;
