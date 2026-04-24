const express = require('express');
const router = express.Router({ mergeParams: true });
const { verifyPlan, getPlanBudgets, createPlanBudget, getPlanBudget, updatePlanBudget, deletePlanBudget } = require('../controllers/planBudgetController');

// Middleware: verify the parent plan exists and belongs to the user
router.use(verifyPlan);

// GET    /plans/:planId/budgets              — List all budget categories in a plan
router.get('/', getPlanBudgets);

// POST   /plans/:planId/budgets              — Add a budget category to a plan
router.post('/', createPlanBudget);

// GET    /plans/:planId/budgets/:id          — Get a single plan budget by ID
router.get('/:id', getPlanBudget);

// PATCH  /plans/:planId/budgets/:id          — Update a plan budget (allocated/spent amounts)
router.patch('/:id', updatePlanBudget);

// DELETE /plans/:planId/budgets/:id          — Remove a budget category from a plan
router.delete('/:id', deletePlanBudget);

module.exports = router;
