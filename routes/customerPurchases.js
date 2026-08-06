const express = require('express');
const router = express.Router();
const customerPurchaseController = require('../controllers/customerPurchaseController');

router.get('/purchase-history', customerPurchaseController.getPurchaseHistory);
router.get('/purchase-history/merchants', customerPurchaseController.getMerchantSummary);
router.get('/merchants', customerPurchaseController.getMerchantSummary);
router.get('/merchants/:merchantId/history', customerPurchaseController.getMerchantHistory);
router.get('/purchase-history/merchant/:merchantId', customerPurchaseController.getMerchantHistory);
router.get('/purchase-history/:id', customerPurchaseController.getPurchaseDetailsById);
router.get('/purchase-history/:id/items', customerPurchaseController.getPurchaseDetailsById);
router.get('/purchases/:id', customerPurchaseController.getPurchaseDetailsById);
router.get('/invoices/:id', customerPurchaseController.getPurchaseDetailsById);
router.get('/loyalty-wallet', customerPurchaseController.getLoyaltyWallet);
router.get('/invoice/:id', customerPurchaseController.getInvoiceDetails);

module.exports = router;
