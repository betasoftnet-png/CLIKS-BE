const express = require('express');
const router = express.Router();
const { getIncomes, createIncome, getIncome, updateIncome, deleteIncome } = require('../controllers/incomeController');

// GET    /income              — List all income records (filterable by source, frequency, date range)
router.get('/', getIncomes);

// POST   /income              — Create a new income record (optionally adds to account balance)
router.post('/', createIncome);

// GET    /income/:id          — Get a single income record by ID
router.get('/:id', getIncome);

// PATCH  /income/:id          — Update income record fields
router.patch('/:id', updateIncome);

// DELETE /income/:id          — Delete an income record
router.delete('/:id', deleteIncome);

module.exports = router;
