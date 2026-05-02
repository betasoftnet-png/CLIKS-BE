const express = require('express');
const router = express.Router();
const billingController = require('../controllers/billingController');
const { auth } = require('../middleware/auth');

router.use(auth);

const businessOnly = (req, res, next) => {
    if (req.user && req.user.role === 'business') {
        next();
    } else {
        res.status(403).json({ success: false, message: 'Access denied. Business account required.' });
    }
};

router.get('/', businessOnly, billingController.getInvoices);
router.post('/', businessOnly, billingController.createInvoice);
router.patch('/:id', businessOnly, billingController.updateInvoice);
router.delete('/:id', businessOnly, billingController.deleteInvoice);

module.exports = router;
