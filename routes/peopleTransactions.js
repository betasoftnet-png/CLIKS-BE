const express = require('express');
const router = express.Router({ mergeParams: true });
const { verifyPerson, getTransactions, createTransaction, getTransaction, updateTransaction, deleteTransaction } = require('../controllers/peopleTransactionsController');

// Middleware: verify the parent person exists and belongs to the user
router.use(verifyPerson);

// GET    /people/:personId/transactions              — List all transactions with a person (lent/borrowed)
router.get('/', getTransactions);

// POST   /people/:personId/transactions              — Record a new transaction with a person
router.post('/', createTransaction);

// GET    /people/:personId/transactions/:id          — Get a single transaction by ID
router.get('/:id', getTransaction);

// PATCH  /people/:personId/transactions/:id          — Update a transaction record
router.patch('/:id', updateTransaction);

// DELETE /people/:personId/transactions/:id          — Delete a transaction record
router.delete('/:id', deleteTransaction);

module.exports = router;
