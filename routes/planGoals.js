const express = require('express');
const router = express.Router({ mergeParams: true });
const { verifyPlan, getPlanGoals, createPlanGoal, getPlanGoal, updatePlanGoal, deletePlanGoal } = require('../controllers/planGoalsController');

// Middleware: verify the parent plan exists and belongs to the user
router.use(verifyPlan);

// GET    /plans/:planId/goals              — List all goals in a plan (filterable by status)
router.get('/', getPlanGoals);

// POST   /plans/:planId/goals              — Add a new goal to a plan
router.post('/', createPlanGoal);

// GET    /plans/:planId/goals/:id          — Get a single plan goal by ID
router.get('/:id', getPlanGoal);

// PATCH  /plans/:planId/goals/:id          — Update a goal (progress, status, deadline)
router.patch('/:id', updatePlanGoal);

// DELETE /plans/:planId/goals/:id          — Remove a goal from a plan
router.delete('/:id', deletePlanGoal);

module.exports = router;
