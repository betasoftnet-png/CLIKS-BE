const express = require('express');
const router = express.Router({ mergeParams: true });
const { verifyPlan, getPlanIncomes, createPlanIncome, getPlanIncome, updatePlanIncome, deletePlanIncome } = require('../controllers/planIncomeController');

// Middleware: verify the parent plan exists and belongs to the user
router.use(verifyPlan);

// GET    /plans/:planId/income              — List all planned income sources in a plan
router.get('/', getPlanIncomes);

// POST   /plans/:planId/income              — Add a planned income source to a plan
router.post('/', createPlanIncome);

// GET    /plans/:planId/income/:id          — Get a single planned income by ID
router.get('/:id', getPlanIncome);

// PATCH  /plans/:planId/income/:id          — Update a planned income (expected/actual amounts)
router.patch('/:id', updatePlanIncome);

// DELETE /plans/:planId/income/:id          — Remove a planned income source from a plan
router.delete('/:id', deletePlanIncome);

module.exports = router;
