const express = require('express');
const router = express.Router({ mergeParams: true });
const { verifyPlan, getPlanReminders, createPlanReminder, getPlanReminder, updatePlanReminder, deletePlanReminder } = require('../controllers/planRemindersController');

// Middleware: verify the parent plan exists and belongs to the user
router.use(verifyPlan);

// GET    /plans/:planId/reminders              — List all reminders for a plan (filterable by status)
router.get('/', getPlanReminders);

// POST   /plans/:planId/reminders              — Add a new reminder to a plan
router.post('/', createPlanReminder);

// GET    /plans/:planId/reminders/:id          — Get a single plan reminder by ID
router.get('/:id', getPlanReminder);

// PATCH  /plans/:planId/reminders/:id          — Update a reminder (title, due_date, status)
router.patch('/:id', updatePlanReminder);

// DELETE /plans/:planId/reminders/:id          — Remove a reminder from a plan
router.delete('/:id', deletePlanReminder);

module.exports = router;
