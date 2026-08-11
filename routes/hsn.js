const express = require('express');
const router = express.Router();
const hsnController = require('../controllers/hsnController');

// Search HSN codes/descriptions
router.get('/search', hsnController.searchHSN);

module.exports = router;
