const express = require('express');
const router = express.Router({ mergeParams: true });
const { verifyPlan, getPlanExpenses, createPlanExpense, getPlanExpense, updatePlanExpense, deletePlanExpense } = require('../controllers/planExpenseController');

// Middleware: verify the parent plan exists and belongs to the user
router.use(verifyPlan);

// GET    /plans/:planId/expenses              — List all planned expenses in a plan
router.get('/', getPlanExpenses);

// POST   /plans/:planId/expenses              — Add a planned expense to a plan
router.post('/', createPlanExpense);

// GET    /plans/:planId/expenses/:id          — Get a single planned expense by ID
router.get('/:id', getPlanExpense);

// PATCH  /plans/:planId/expenses/:id          — Update a planned expense (expected/actual amounts)
router.patch('/:id', updatePlanExpense);

// DELETE /plans/:planId/expenses/:id          — Remove a planned expense from a plan
router.delete('/:id', deletePlanExpense);

module.exports = router;
