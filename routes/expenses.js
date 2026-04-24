const express = require('express');
const router = express.Router();
const { getExpenses, createExpense, getExpense, updateExpense, deleteExpense } = require('../controllers/expensesController');

// GET    /expenses              — List all expenses (filterable by category, date range)
router.get('/', getExpenses);

// POST   /expenses              — Create a new expense (optionally deducts from account balance)
router.post('/', createExpense);

// GET    /expenses/:id          — Get a single expense by ID
router.get('/:id', getExpense);

// PATCH  /expenses/:id          — Update expense fields
router.patch('/:id', updateExpense);

// DELETE /expenses/:id          — Delete an expense
router.delete('/:id', deleteExpense);

module.exports = router;
