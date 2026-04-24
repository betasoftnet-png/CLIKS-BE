const express = require('express');
const router = express.Router();
const cache = require('../middleware/cache');
const { getDashboard, getWidgets, updateWidgets } = require('../controllers/homeController');

// GET  /home           — Get full dashboard summary (balance, income, expenses, savings, debts, investments)
router.get('/', cache(30), getDashboard);

// GET  /home/summary   — Alias for the dashboard summary (same data)
router.get('/summary', cache(30), getDashboard);

// GET  /home/widgets   — Get the user's saved widget layout
router.get('/widgets', getWidgets);

// POST /home/widgets   — Save / update the user's widget layout
router.post('/widgets', updateWidgets);

module.exports = router;
