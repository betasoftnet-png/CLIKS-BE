const express = require('express');
const router = express.Router();
const businessController = require('../controllers/businessController');
const { auth, businessOnly, requireBusinessAccount } = require('../middleware/auth');

// All business routes are protected
router.use(auth);
router.use(businessOnly);

router.get('/stats', businessController.getBusinessStats);
router.get('/operations', businessController.getRecentOperations);

module.exports = router;
