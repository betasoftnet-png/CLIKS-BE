const express = require('express');
const router = express.Router();
const manufacturingController = require('../controllers/manufacturingController');
const { auth, businessOnly, requireBusinessAccount } = require('../middleware/auth');

router.use(auth);
router.use(businessOnly);


router.post('/bom', manufacturingController.createBom);
router.post('/orders', manufacturingController.createOrder);
router.post('/start', manufacturingController.startProduction);
router.post('/complete', manufacturingController.completeProduction);
router.get('/reports', manufacturingController.getReports);

module.exports = router;
