const express = require('express');
const router = express.Router();
const { getCalendar } = require('../controllers/financialCalendarController');

// GET /calendar        — Get all upcoming financial events (payments, reminders, debts, savings deadlines, goals)
router.get('/', getCalendar);

module.exports = router;
