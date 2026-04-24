const express = require('express');
const router = express.Router();
const { getSegregations, createSegregation, getSegregation, updateSegregation, deleteSegregation } = require('../controllers/segregationController');

// GET    /segregation              — List all income segregation rules (filterable by rule_type)
router.get('/', getSegregations);

// POST   /segregation              — Create a new segregation rule with allocations (must sum to 100%)
router.post('/', createSegregation);

// GET    /segregation/:id          — Get a single segregation rule with its allocations
router.get('/:id', getSegregation);

// PATCH  /segregation/:id          — Update a rule and optionally replace its allocations
router.patch('/:id', updateSegregation);

// DELETE /segregation/:id          — Delete a rule and all its allocations
router.delete('/:id', deleteSegregation);

module.exports = router;
