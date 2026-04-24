const express = require('express');
const router = express.Router();
const { getAccounts, createAccount, getAccount, updateAccount, deleteAccount } = require('../controllers/accountsController');

// GET    /accounts             — List all accounts (paginated, filterable)
router.get('/', getAccounts);

// POST   /accounts             — Create a new account
router.post('/', createAccount);

// GET    /accounts/:id         — Get a single account by ID
router.get('/:id', getAccount);

// PATCH  /accounts/:id         — Update an account
router.patch('/:id', updateAccount);

// DELETE /accounts/:id         — Delete an account
router.delete('/:id', deleteAccount);

module.exports = router;
