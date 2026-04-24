const express = require('express');
const router = express.Router();
const { getStockStats, getStocks, createStock, getStock, updateStock, adjustQuantity, deleteStock } = require('../controllers/stockController');

// ── Stats route (must be before /:id to avoid being caught by the param route) ─

// GET    /stock/stats                    — Get inventory aggregate stats (total items, value, stock counts, categories)
router.get('/stats', getStockStats);

// ── Stock CRUD ────────────────────────────────────────────────────────────────

// GET    /stock                          — List all stock items (filterable by category, location, status)
router.get('/', getStocks);

// POST   /stock                          — Create a new stock item
router.post('/', createStock);

// GET    /stock/:id                      — Get a single stock item by ID (includes computed status & value)
router.get('/:id', getStock);

// PATCH  /stock/:id                      — Update stock item fields
router.patch('/:id', updateStock);

// PATCH  /stock/:id/adjust-quantity      — Adjust quantity by a delta (positive or negative)
router.patch('/:id/adjust-quantity', adjustQuantity);

// DELETE /stock/:id                      — Delete a stock item
router.delete('/:id', deleteStock);

module.exports = router;
