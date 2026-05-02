const express = require('express');
const router = express.Router();
const inventoryController = require('../controllers/inventoryController');
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

router.get('/', businessOnly, inventoryController.getInventory);
router.post('/', businessOnly, inventoryController.addInventoryItem);
router.patch('/:id', businessOnly, inventoryController.updateInventoryItem);
router.patch('/:id/stock', businessOnly, inventoryController.adjustStock);
router.delete('/:id', businessOnly, inventoryController.deleteInventoryItem);

module.exports = router;
