const express = require('express');
const router = express.Router();
const businessController = require('../controllers/businessController');
const { auth } = require('../middleware/auth');

// All business routes are protected
router.use(auth);

// Check if user has business role
const businessOnly = (req, res, next) => {
    if (req.user && req.user.role === 'business') {
        next();
    } else {
        res.status(403).json({ success: false, message: 'Access denied. Business account required.' });
    }
};

router.get('/stats', businessOnly, businessController.getBusinessStats);
router.get('/operations', businessOnly, businessController.getRecentOperations);

module.exports = router;
