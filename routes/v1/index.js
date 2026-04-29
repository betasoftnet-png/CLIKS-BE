/**
 * routes/v1/index.js
 *
 * Central v1 Router — aggregates all existing flat route files.
 *
 * Mounted in app.js at:
 *   app.use('/api/v1', require('./routes/v1'));
 *
 * ⚠️  All actual route files still live in routes/*.js (flat structure).
 *      This file is a THIN DELEGATION LAYER — nothing is rewritten here.
 *      Future migrations move individual files into routes/v1/ progressively.
 */

const router = require('express').Router();
const { auth } = require('../../middleware/auth');

// ── Health ─────────────────────────────────────────────────────────────────
router.get('/health', (req, res) =>
  res.json({ success: true, data: { status: 'ok', version: 'v1', timestamp: new Date().toISOString() } })
);

// ── Auth (no middleware) ───────────────────────────────────────────────────
router.use('/auth',    require('../auth'));

// ── Public Feed ────────────────────────────────────────────────────────────
router.use('/public',  require('../public'));

// ── Admin (auth + RBAC handled inside route file) ─────────────────────────
router.use('/admin',   require('../admin'));

// ── Personal ──────────────────────────────────────────────────────────────
router.use('/profile', auth, require('../profile'));
router.use('/home',    auth, require('../home'));

// ── Core Finance ──────────────────────────────────────────────────────────
router.use('/accounts',         auth, require('../accounts'));
router.use('/transactions',     auth, require('../transactions'));
router.use('/income',           auth, require('../income'));
router.use('/expenses',         auth, require('../expenses'));
router.use('/budgets',          auth, require('../budgets'));
router.use('/savings',          auth, require('../savings'));
router.use('/investments',      auth, require('../investments'));
router.use('/debts',            auth, require('../debts'));
router.use('/planned-payments', auth, require('../plannedPayments'));
router.use('/goal-wallets',    auth, require('../goalWallet'));

// ── Books Module ───────────────────────────────────────────────────────────
router.use('/stock',            auth, require('../stock'));

// ── Financial Plans (static paths before param paths) ─────────────────────
router.use('/financial-plans/calendar',                auth, require('../financialCalendar'));
router.use('/financial-plans/:planId/budgets',         auth, require('../planBudget'));
router.use('/financial-plans/:planId/income',          auth, require('../planIncome'));
router.use('/financial-plans/:planId/expenses',        auth, require('../planExpense'));
router.use('/financial-plans/:planId/goals',           auth, require('../planGoals'));
router.use('/financial-plans/:planId/reminders',       auth, require('../planReminders'));
router.use('/financial-plans/:planId/analysis',        auth, require('../planAnalysis'));
router.use('/financial-plans',                         auth, require('../financialPlan'));

// ── People (nested before parent) ─────────────────────────────────────────
router.use('/people/:personId/transactions', auth, require('../peopleTransactions'));
router.use('/people/:personId/reminders',   auth, require('../peopleReminders'));
router.use('/people/:personId/records',     auth, require('../peopleRecords'));
router.use('/people',                       auth, require('../people'));

// ── Contacts & Shared ──────────────────────────────────────────────────────
router.use('/contacts',       auth, require('../contacts'));
router.use('/segregation',    auth, require('../segregation'));
router.use('/split-expenses', auth, require('../splitExpense'));

module.exports = router;
