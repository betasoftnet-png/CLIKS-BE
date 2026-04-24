const express = require('express');
const router = express.Router();
const { getTransactions, createTransaction, getTransaction, updateTransaction, deleteTransaction } = require('../controllers/transactionsController');

// GET    /transactions              — List all transactions (filterable by type, account, category, date range)
router.get('/', getTransactions);

// POST   /transactions              — Create a new transaction (optionally updates linked account balance)
router.post('/', createTransaction);

// GET    /transactions/:id          — Get a single transaction by ID
router.get('/:id', getTransaction);

// PATCH  /transactions/:id          — Update transaction fields
router.patch('/:id', updateTransaction);

// DELETE /transactions/:id          — Delete a transaction
router.delete('/:id', deleteTransaction);

module.exports = router;
