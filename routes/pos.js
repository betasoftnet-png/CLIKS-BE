const express = require('express');
const router = express.Router();
const posController = require('../controllers/posController');
const { auth, businessOnly, requireBusinessAccount } = require('../middleware/auth');

router.use(auth);
router.use(businessOnly);


router.post('/checkout', posController.checkout);
router.get('/today-summary', posController.getTodaySummary);
router.get('/orders', posController.getOrders);
router.get('/product-analytics', posController.getProductAnalytics);
router.get('/shop-details', posController.getShopDetails);

router.get('/session', posController.getPosSession);
router.post('/session', posController.savePosSession);
router.delete('/session', posController.clearPosSession);

router.get('/held-carts', posController.getHeldCarts);
router.post('/held-carts', posController.saveHeldCarts);
router.delete('/held-carts/:id', posController.deleteHeldCart);

module.exports = router;

