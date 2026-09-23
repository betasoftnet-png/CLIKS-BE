const express = require('express');
const router = express.Router();
const {
  getAllTransactions,
  getAllReminders,
  createRepaymentAlert,
  deleteRepaymentAlert,
  updateRepaymentAlert,
  getAllRecords,
  getPeople,
  createPerson,
  getPerson,
  updatePerson,
  deletePerson
} = require('../controllers/peopleController');
const asyncHandler = require('../utils/asyncHandler');

// ── Global aggregated views (must be declared before /:id) ────────────────────

// GET /people/transactions  — List all people transactions across all contacts
router.get('/transactions', asyncHandler(getAllTransactions));

// Repayment Alerts (Central PostgreSQL persistence)
// GET    /people/reminders     — List all people repayment alerts across all contacts
router.get('/reminders', asyncHandler(getAllReminders));
router.get('/repayment-alerts', asyncHandler(getAllReminders));

// POST   /people/reminders     — Dispatch / create a new repayment alert
router.post('/reminders', asyncHandler(createRepaymentAlert));
router.post('/repayment-alerts', asyncHandler(createRepaymentAlert));

// DELETE /people/reminders/:id — Delete / dismiss a repayment alert
router.delete('/reminders/:id', asyncHandler(deleteRepaymentAlert));
router.delete('/repayment-alerts/:id', asyncHandler(deleteRepaymentAlert));

// PATCH  /people/reminders/:id — Update repayment alert status (e.g. Settled / Dispatched)
router.patch('/reminders/:id', asyncHandler(updateRepaymentAlert));
router.patch('/repayment-alerts/:id', asyncHandler(updateRepaymentAlert));

// GET /people/records       — List all people records across all contacts
router.get('/records', asyncHandler(getAllRecords));

// ── People CRUD ───────────────────────────────────────────────────────────────

// GET    /people              — List all people (with aggregated lent/borrowed/net balance)
router.get('/', asyncHandler(getPeople));

// POST   /people              — Create a new person/contact
router.post('/', asyncHandler(createPerson));

// GET    /people/:id          — Get a single person by ID
router.get('/:id', asyncHandler(getPerson));

// PATCH  /people/:id          — Update person fields
router.patch('/:id', asyncHandler(updatePerson));

// DELETE /people/:id          — Delete a person and all their transactions, reminders, and records
router.delete('/:id', asyncHandler(deletePerson));

module.exports = router;
