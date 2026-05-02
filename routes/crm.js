const express = require('express');
const router = express.Router();
const crmController = require('../controllers/crmController');
const { auth } = require('../middleware/auth');

// All CRM routes require authentication
router.use(auth);

// Business role check middleware
const businessOnly = (req, res, next) => {
    if (req.user && req.user.role === 'business') {
        next();
    } else {
        res.status(403).json({ success: false, message: 'Access denied. Business account required.' });
    }
};

router.use(businessOnly);

// Customer Routes
router.get('/customers', crmController.getCustomers);
router.post('/customers', crmController.createCustomer);
router.patch('/customers/:id', crmController.updateCustomer);
router.delete('/customers/:id', crmController.deleteCustomer);

module.exports = router;
