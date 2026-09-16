const express = require('express');
const router = express.Router();
const employeeController = require('../controllers/employeeController');
const { auth, businessOnly, requireBusinessAccount } = require('../middleware/auth');

router.use(auth);
router.use(businessOnly);


router.post('/', employeeController.createEmployee);
router.post('/:id/documents', employeeController.uploadDocuments);
router.get('/', employeeController.getEmployees);
router.get('/activity', employeeController.getActivityLogs);
router.get('/performance', employeeController.getPerformanceReports);
router.get('/:id', employeeController.getEmployeeById);
router.post('/:id/role', employeeController.assignRole);

module.exports = router;
