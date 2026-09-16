const express = require('express');
const router = express.Router();
const crmController = require('../controllers/crmController');
const { auth, businessOnly, requireBusinessAccount } = require('../middleware/auth');

// All CRM routes require authentication
router.use(auth);
router.use(businessOnly);


// Customer Routes
router.get('/customers', crmController.getCustomers);
router.post('/customers', crmController.createCustomer);
router.patch('/customers/:id', crmController.updateCustomer);
router.delete('/customers/:id', crmController.deleteCustomer);

module.exports = router;
