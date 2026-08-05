const express = require('express');
const router = express.Router();
const vendorController = require('../controllers/vendorController');
const { authenticateToken } = require('../middleware/auth');

router.get('/', authenticateToken, vendorController.getVendors);
router.get('/:id', authenticateToken, vendorController.getVendorById);
router.post('/', authenticateToken, vendorController.createVendor);
router.put('/:id', authenticateToken, vendorController.updateVendor);
router.patch('/:id', authenticateToken, vendorController.updateVendor);
router.delete('/:id', authenticateToken, vendorController.deleteVendor);

module.exports = router;
