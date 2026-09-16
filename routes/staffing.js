const express = require('express');
const router = express.Router();
const staffingController = require('../controllers/staffingController');
const { auth, businessOnly, requireBusinessAccount } = require('../middleware/auth');

// All staffing routes require authentication
router.use(auth);
router.use(businessOnly);


// Employee Routes
router.get('/employees', staffingController.getEmployees);
router.post('/employees', staffingController.createEmployee);
router.patch('/employees/:id', staffingController.updateEmployee);
router.delete('/employees/:id', staffingController.deleteEmployee);

module.exports = router;
