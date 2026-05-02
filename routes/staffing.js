const express = require('express');
const router = express.Router();
const staffingController = require('../controllers/staffingController');
const { auth } = require('../middleware/auth');

// All staffing routes require authentication
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

// Employee Routes
router.get('/employees', staffingController.getEmployees);
router.post('/employees', staffingController.createEmployee);
router.patch('/employees/:id', staffingController.updateEmployee);
router.delete('/employees/:id', staffingController.deleteEmployee);

module.exports = router;
