const express = require('express');
const router = express.Router();
const businessWalletController = require('../controllers/businessWalletController');
const { auth, businessOnly, requireBusinessAccount } = require('../middleware/auth');

router.use(auth);
router.use(businessOnly);


router.get('/', businessWalletController.getWallet);
router.post('/add', businessWalletController.addMoney);
router.post('/convert-points', businessWalletController.convertPoints);

module.exports = router;
