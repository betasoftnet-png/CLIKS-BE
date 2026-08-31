const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');
const { authenticateToken } = require('../middleware/auth');

router.get('/', authenticateToken, customerController.getCustomers);
router.get('/lookup', authenticateToken, customerController.lookupCustomerByEmail);
router.post('/import', authenticateToken, customerController.importCustomers);
router.post('/b2b-respond', authenticateToken, customerController.respondB2BConnection);
router.get('/:id', authenticateToken, customerController.getCustomerById);
router.post('/', authenticateToken, customerController.createCustomer);
router.put('/:id', authenticateToken, customerController.updateCustomer);
router.patch('/:id', authenticateToken, customerController.updateCustomer);
router.delete('/:id', authenticateToken, customerController.deleteCustomer);

module.exports = router;
