const express = require('express');
const router = express.Router();
const { getInvestments, createInvestment, getInvestment, updateInvestment, deleteInvestment } = require('../controllers/investmentsController');

// GET    /investments              — List all investments (filterable by type, searchable by name)
router.get('/', getInvestments);

// POST   /investments              — Create a new investment record
router.post('/', createInvestment);

// GET    /investments/:id          — Get a single investment by ID
router.get('/:id', getInvestment);

// PATCH  /investments/:id          — Update investment fields (current value, notes, etc.)
router.patch('/:id', updateInvestment);

// DELETE /investments/:id          — Delete an investment record
router.delete('/:id', deleteInvestment);

module.exports = router;
