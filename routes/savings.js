const express = require('express');
const router = express.Router();
const { getSavings, createSavings, getSaving, updateSaving, depositSaving, deleteSaving } = require('../controllers/savingsController');

// GET    /savings                    — List all savings goals (searchable by name)
router.get('/', getSavings);

// POST   /savings                    — Create a new savings goal
router.post('/', createSavings);

// GET    /savings/:id                — Get a single savings goal by ID
router.get('/:id', getSaving);

// PATCH  /savings/:id                — Update savings goal fields (name, target, deadline)
router.patch('/:id', updateSaving);

// PATCH  /savings/:id/deposit        — Add funds to a savings goal (capped at target_amount)
router.patch('/:id/deposit', depositSaving);

// DELETE /savings/:id                — Delete a savings goal
router.delete('/:id', deleteSaving);

module.exports = router;
