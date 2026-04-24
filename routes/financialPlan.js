const express = require('express');
const router = express.Router();
const { getPlans, createPlan, getPlan, updatePlan, deletePlan } = require('../controllers/financialPlanController');

// GET    /plans              — List all financial plans (filterable by status, date range)
router.get('/', getPlans);

// POST   /plans              — Create a new financial plan
router.post('/', createPlan);

// GET    /plans/:id          — Get a single plan by ID (includes budget/goal/reminder counts)
router.get('/:id', getPlan);

// PATCH  /plans/:id          — Update plan fields (title, status, dates)
router.patch('/:id', updatePlan);

// DELETE /plans/:id          — Delete a plan and all its sub-resources (cascade)
router.delete('/:id', deletePlan);

module.exports = router;
