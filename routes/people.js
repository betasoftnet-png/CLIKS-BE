const express = require('express');
const router = express.Router();
const { getAllTransactions, getAllReminders, getAllRecords, getPeople, createPerson, getPerson, updatePerson, deletePerson } = require('../controllers/peopleController');

// ── Global aggregated views (must be declared before /:id) ────────────────────

// GET /people/transactions  — List all people transactions across all contacts
router.get('/transactions', getAllTransactions);

// GET /people/reminders     — List all people reminders across all contacts (with overdue stats)
router.get('/reminders', getAllReminders);

// GET /people/records       — List all people records across all contacts
router.get('/records', getAllRecords);

// ── People CRUD ───────────────────────────────────────────────────────────────

// GET    /people              — List all people (with aggregated lent/borrowed/net balance)
router.get('/', getPeople);

// POST   /people              — Create a new person/contact
router.post('/', createPerson);

// GET    /people/:id          — Get a single person by ID
router.get('/:id', getPerson);

// PATCH  /people/:id          — Update person fields
router.patch('/:id', updatePerson);

// DELETE /people/:id          — Delete a person and all their transactions, reminders, and records
router.delete('/:id', deletePerson);

module.exports = router;
