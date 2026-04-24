const express = require('express');
const router = express.Router({ mergeParams: true });
const { verifyPerson, getReminders, createReminder, getReminder, updateReminder, deleteReminder } = require('../controllers/peopleRemindersController');

// Middleware: verify the parent person exists and belongs to the user
router.use(verifyPerson);

// GET    /people/:personId/reminders              — List all reminders for a person
router.get('/', getReminders);

// POST   /people/:personId/reminders              — Create a new reminder for a person
router.post('/', createReminder);

// GET    /people/:personId/reminders/:id          — Get a single reminder by ID
router.get('/:id', getReminder);

// PATCH  /people/:personId/reminders/:id          — Update a reminder (title, due_date, status)
router.patch('/:id', updateReminder);

// DELETE /people/:personId/reminders/:id          — Delete a reminder
router.delete('/:id', deleteReminder);

module.exports = router;
