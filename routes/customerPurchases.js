const express = require('express');
const router = express.Router();
const customerPurchaseController = require('../controllers/customerPurchaseController');

router.get('/purchase-history', customerPurchaseController.getPurchaseHistory);
router.get('/loyalty-wallet', customerPurchaseController.getLoyaltyWallet);

module.exports = router;
