const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
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

router.post('/receive', paymentController.receivePayment);
router.post('/pay', paymentController.paySupplier);
router.get('/reports', paymentController.getReports);
router.get('/outstanding', paymentController.getOutstanding);
router.post('/create-order', paymentController.createCashfreeOrder);

module.exports = router;
