/**
 * middleware/validate.js
 * 
 * Re-usable validation rule sets using express-validator.
 * Import the ruleset for your route, then call `handleValidation` as the next middleware.
 *
 * Usage:
 *   router.post('/', validate.createTransaction, validate.handle, (req, res) => { ... });
 */

const { body, query, validationResult } = require('express-validator');

// ── Run collected rules and return 422 if any fail ────────────────────────────
const handle = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        fields: errors.array().map(e => ({ field: e.path, message: e.msg }))
      }
    });
  }
  next();
};

// ── Shared reusable rules ─────────────────────────────────────────────────────
const positiveAmount = (field = 'amount') =>
  body(field).isFloat({ gt: 0 }).withMessage(`${field} must be a positive number`);

const optionalPositiveAmount = (field) =>
  body(field).optional().isFloat({ gt: 0 }).withMessage(`${field} must be a positive number`);

const isoDate = (field) =>
  body(field).isISO8601().withMessage(`${field} must be a valid ISO 8601 date (e.g. 2024-01-31)`);

const optionalIsoDate = (field) =>
  body(field).optional().isISO8601().withMessage(`${field} must be a valid ISO 8601 date`);

const requiredString = (field, max = 255) =>
  body(field).notEmpty().isString().isLength({ max }).withMessage(`${field} is required (max ${max} chars)`);

const optionalString = (field, max = 255) =>
  body(field).optional().isString().isLength({ max }).withMessage(`${field} must be a string (max ${max} chars)`);

// ── Auth ──────────────────────────────────────────────────────────────────────
const login = [
  body('email').optional().isEmail().withMessage('Valid email required'),
  body('username').optional().isString().notEmpty().withMessage('Username required if no email'),
  body('password').notEmpty().withMessage('password is required'),
];

const register = [
  requiredString('username', 50),
  body('email').isEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 6 }).withMessage('password must be at least 6 characters'),
];

// ── Transactions ──────────────────────────────────────────────────────────────
const createTransaction = [
  requiredString('type', 50),
  positiveAmount('amount'),
  isoDate('date'),
  optionalString('description'),
  optionalString('category', 100),
];

// ── Income / Expenses ─────────────────────────────────────────────────────────
const createIncome = [
  requiredString('source', 100),
  positiveAmount('amount'),
  isoDate('date'),
  optionalString('category', 100),
  optionalString('notes'),
];

const createExpense = [
  requiredString('category', 100),
  positiveAmount('amount'),
  isoDate('date'),
  optionalString('description'),
  optionalString('notes'),
];

// ── Accounts ──────────────────────────────────────────────────────────────────
const createAccount = [
  requiredString('name', 100),
  requiredString('type', 50),
  body('balance').optional().isFloat().withMessage('balance must be a number'),
];

// ── Budgets ───────────────────────────────────────────────────────────────────
const createBudget = [
  requiredString('category', 100),
  positiveAmount('amount'),
  optionalIsoDate('start_date'),
  optionalIsoDate('end_date'),
];

// ── Savings ───────────────────────────────────────────────────────────────────
const createSaving = [
  requiredString('name', 100),
  positiveAmount('target_amount'),
  optionalPositiveAmount('current_amount'),
  optionalIsoDate('deadline'),
];

// ── Investments ───────────────────────────────────────────────────────────────
const createInvestment = [
  requiredString('name', 100),
  requiredString('type', 50),
  positiveAmount('amount'),
  optionalIsoDate('date'),
];

// ── Debts ─────────────────────────────────────────────────────────────────────
const createDebt = [
  requiredString('creditor_name', 100),
  positiveAmount('amount'),
  optionalPositiveAmount('amount_paid'),
  optionalIsoDate('due_date'),
];

// ── Stock ─────────────────────────────────────────────────────────────────────
const createStock = [
  requiredString('name', 100),
  optionalString('sku', 100),
  body('quantity').optional().isInt({ min: 0 }).withMessage('quantity must be a non-negative integer'),
  optionalPositiveAmount('unit_price'),
];

const adjustQuantity = [
  body('delta').notEmpty().isInt().withMessage('delta must be an integer (positive or negative)'),
];

// ── Financial Plans ───────────────────────────────────────────────────────────
const createPlan = [
  requiredString('title', 150),
  optionalString('description'),
  optionalIsoDate('start_date'),
  optionalIsoDate('end_date'),
  body('status').optional().isIn(['draft', 'active', 'completed', 'archived'])
    .withMessage('status must be: draft, active, completed, or archived'),
];

// ── Plan Goals ────────────────────────────────────────────────────────────────
const createGoal = [
  requiredString('name', 150),
  positiveAmount('target_amount'),
  optionalPositiveAmount('current_amount'),
  optionalIsoDate('deadline'),
  body('status').optional().isIn(['in_progress', 'achieved', 'cancelled'])
    .withMessage('status must be: in_progress, achieved, or cancelled'),
];

// ── Plan Reminders ────────────────────────────────────────────────────────────
const createPlanReminder = [
  requiredString('title', 150),
  isoDate('due_date'),
  requiredString('type', 50),
  body('status').optional().isIn(['pending', 'sent', 'dismissed'])
    .withMessage('status must be: pending, sent, or dismissed'),
];

// ── People ────────────────────────────────────────────────────────────────────
const createPerson = [
  requiredString('name', 100),
  requiredString('role_type', 50),
  optionalString('company', 100),
  optionalString('contact_info'),
];

// ── People Transactions ───────────────────────────────────────────────────────
const createPersonTransaction = [
  requiredString('type', 50),
  positiveAmount('amount'),
  isoDate('date'),
  optionalString('description'),
  optionalString('category', 100),
];

// ── Contacts ──────────────────────────────────────────────────────────────────
const createContact = [
  requiredString('name', 100),
  body('email').optional().isEmail().withMessage('Valid email required'),
  optionalString('phone', 30),
  optionalString('company', 100),
];

// ── Segregation ───────────────────────────────────────────────────────────────
const createSegregation = [
  requiredString('name', 100),
  requiredString('rule_type', 50),
  body('allocations').optional().isArray().withMessage('allocations must be an array'),
  body('allocations.*.label').if(body('allocations').exists()).notEmpty()
    .withMessage('Each allocation must have a label'),
  body('allocations.*.percentage').if(body('allocations').exists())
    .isFloat({ gt: 0, lt: 100 }).withMessage('Each allocation percentage must be between 0 and 100'),
];

// ── Split Expenses ────────────────────────────────────────────────────────────
const createSplitExpense = [
  requiredString('title', 150),
  positiveAmount('total_amount'),
  isoDate('date'),
  body('participants').optional().isArray().withMessage('participants must be an array'),
  body('participants.*.name').if(body('participants').exists()).notEmpty()
    .withMessage('Each participant must have a name'),
  body('participants.*.share_amount').if(body('participants').exists())
    .isFloat({ gt: 0 }).withMessage('Each participant share_amount must be a positive number'),
];

// ── Public Posts ──────────────────────────────────────────────────────────────
const createPost = [
  body('content').notEmpty().isString().isLength({ max: 500 })
    .withMessage('content is required and must not exceed 500 characters'),
  body('type').optional().isIn(['update', 'tip', 'goal', 'achievement'])
    .withMessage('type must be: update, tip, goal, or achievement'),
];

// ── Profile ───────────────────────────────────────────────────────────────────
const updateProfile = [
  optionalString('username', 50),
  body('email').optional().isEmail().withMessage('Valid email required'),
];

const changePassword = [
  body('currentPassword').notEmpty().withMessage('currentPassword is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('newPassword must be at least 6 characters'),
];

// ── Common paging query params ────────────────────────────────────────────────
const listQuery = [
  query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
  query('order').optional().isIn(['asc', 'desc']).withMessage('order must be asc or desc'),
];

module.exports = {
  handle,
  login,
  register,
  createTransaction,
  createIncome,
  createExpense,
  createAccount,
  createBudget,
  createSaving,
  createInvestment,
  createDebt,
  createStock,
  adjustQuantity,
  createPlan,
  createGoal,
  createPlanReminder,
  createPerson,
  createPersonTransaction,
  createContact,
  createSegregation,
  createSplitExpense,
  createPost,
  updateProfile,
  changePassword,
  listQuery,
};
