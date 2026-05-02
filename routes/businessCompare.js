const express = require('express');
const router = express.Router();
const businessCompareController = require('../controllers/businessCompareController');

router.get('/scenarios', businessCompareController.getComparisonSummary);
router.get('/periodic', businessCompareController.getPeriodicComparison);

module.exports = router;
