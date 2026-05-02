const express = require('express');
const router = express.Router();
const businessFinancialPlanController = require('../controllers/businessFinancialPlanController');

router.get('/', businessFinancialPlanController.getPlans);
router.post('/', businessFinancialPlanController.createPlan);
router.delete('/:id', businessFinancialPlanController.deletePlan);

router.get('/:id/items', businessFinancialPlanController.getPlanItems);
router.post('/:id/items', businessFinancialPlanController.addPlanItem);

module.exports = router;
