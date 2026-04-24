const express = require('express');
const router = express.Router();
const { getBudgets, createBudget, getBudget, updateBudget, spendBudget, deleteBudget } = require('../controllers/budgetsController');

// GET    /budgets              — List all budgets (filterable by category, period)
router.get('/', getBudgets);

// POST   /budgets              — Create a new budget
router.post('/', createBudget);

// GET    /budgets/:id          — Get a single budget by ID
router.get('/:id', getBudget);

// PATCH  /budgets/:id          — Update budget fields
router.patch('/:id', updateBudget);

// PATCH  /budgets/:id/spend    — Add to the amount_spent of a budget
router.patch('/:id/spend', spendBudget);

// DELETE /budgets/:id          — Delete a budget
router.delete('/:id', deleteBudget);

module.exports = router;
