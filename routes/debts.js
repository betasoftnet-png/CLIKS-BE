const express = require('express');
const router = express.Router();
const { getDebts, createDebt, getDebt, updateDebt, payDebt, deleteDebt } = require('../controllers/debtsController');

// GET    /debts              — List all debts (filterable by creditor)
router.get('/', getDebts);

// POST   /debts              — Create a new debt record
router.post('/', createDebt);

// GET    /debts/:id          — Get a single debt by ID
router.get('/:id', getDebt);

// PATCH  /debts/:id          — Update debt fields
router.patch('/:id', updateDebt);

// PATCH  /debts/:id/pay      — Record a payment against a debt
router.patch('/:id/pay', payDebt);

// DELETE /debts/:id          — Delete a debt record
router.delete('/:id', deleteDebt);

module.exports = router;
