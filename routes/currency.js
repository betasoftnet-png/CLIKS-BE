const express = require('express');
const router = express.Router();
const currencyController = require('../controllers/currencyController');

// Mounted in app.js at '/api/v1/currency'
router.get('/rates', currencyController.getLiveRates);
router.post('/convert', currencyController.convertCurrency);

module.exports = router;
