const express = require('express');
const router = express.Router();
const businessWalletController = require('../controllers/businessWalletController');
const { auth } = require('../middleware/auth');

router.use(auth);

const businessOnly = (req, res, next) => {
    if (req.user && req.user.role === 'business') {
        next();
    } else {
        res.status(403).json({ success: false, message: 'Access denied. Business account required.' });
    }
};

router.use(businessOnly);

router.get('/', businessWalletController.getWallet);
router.post('/add', businessWalletController.addMoney);
router.post('/convert-points', businessWalletController.convertPoints);

module.exports = router;
