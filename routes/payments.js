const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { auth, businessOnly, requireBusinessAccount } = require('../middleware/auth');

router.use(auth);
router.use(businessOnly);


router.post('/receive', paymentController.receivePayment);
router.post('/customer-receipts', paymentController.receivePayment);
router.post('/pay', paymentController.paySupplier);
router.post('/transfer', paymentController.transferVault);
router.get('/reports', paymentController.getReports);
router.get('/outstanding', paymentController.getOutstanding);
router.post('/create-order', paymentController.createCashfreeOrder);
router.get('/create-order', paymentController.createCashfreeOrder);

module.exports = router;
