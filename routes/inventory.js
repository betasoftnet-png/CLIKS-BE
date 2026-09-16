const express = require('express');
const router = express.Router();
const inventoryController = require('../controllers/inventoryController');
const { auth, businessOnly, requireBusinessAccount } = require('../middleware/auth');

router.use(auth);
router.use(businessOnly);

router.get('/', inventoryController.getInventory);
router.post('/', inventoryController.addInventoryItem);
router.patch('/:id', inventoryController.updateInventoryItem);
router.patch('/:id/stock', inventoryController.adjustStock);
router.delete('/:id', inventoryController.deleteInventoryItem);

module.exports = router;

