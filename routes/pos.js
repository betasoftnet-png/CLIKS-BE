const express = require('express');
const router = express.Router();
const posController = require('../controllers/posController');
const { auth, businessOnly, requireBusinessAccount } = require('../middleware/auth');

router.use(auth);
router.use(businessOnly);


router.post('/checkout', posController.checkout);
router.get('/today-summary', posController.getTodaySummary);
router.get('/orders', posController.getOrders);

module.exports = router;
