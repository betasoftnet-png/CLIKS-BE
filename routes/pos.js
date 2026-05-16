const express = require('express');
const router = express.Router();
const posController = require('../controllers/posController');
const { auth } = require('../middleware/auth');

router.use(auth);

// Check if user has business role
const businessOnly = (req, res, next) => {
    if (req.user && req.user.role === 'business') {
        next();
    } else {
        res.status(403).json({ success: false, message: 'Access denied. Business account required.' });
    }
};

router.use(businessOnly);

router.post('/checkout', posController.checkout);
router.get('/today-summary', posController.getTodaySummary);
router.get('/orders', posController.getOrders);

module.exports = router;
