const express = require('express');
const router = express.Router();
const controller = require('../controllers/financePlusController');
const { auth } = require('../middleware/auth');

// Financial Goals
router.get('/goals', auth, controller.getGoals);
router.post('/goals', auth, controller.createGoal);
router.put('/goals/:id', auth, controller.updateGoal);
router.delete('/goals/:id', auth, controller.deleteGoal);

// Salary
router.get('/salary', auth, controller.getSalaryRecords);
router.post('/salary', auth, controller.createSalaryRecord);

// Property
router.get('/property', auth, controller.getPropertyRecords);
router.post('/property', auth, controller.createProperty);
router.post('/property/:id/rent', auth, controller.recordRentReceived);

// Pension
router.get('/pension', auth, controller.getPensionRecords);
router.post('/pension', auth, controller.recordPension);

// Tax
router.get('/tax', auth, controller.getTaxRecords);
router.post('/tax', auth, controller.saveTaxRecord);

// Notifications
router.get('/notifications', auth, controller.getNotifications);
router.put('/notifications/:id/read', auth, controller.markNotificationRead);

// User Profile Role
router.put('/primary-income', auth, controller.updatePrimaryIncomeSource);

module.exports = router;
