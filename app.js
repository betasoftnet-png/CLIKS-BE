const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const path = require('path');

const { auth } = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');
const { globalLimiter } = require('./middleware/rateLimiter');
const apiVersion = require('./middleware/apiVersion');
const requestLogger = require('./middleware/requestLogger');
const { initSentry } = require('./utils/sentry');

// ── Initialise Sentry FIRST (before any other middleware) ───────────────────────
// No-ops silently when SENTRY_DSN is not set (dev/test safe)
initSentry();

// Initialize Express App
const app = express();

// Load OpenAPI Documentation
const swaggerDocument = YAML.load(path.join(__dirname, 'openapi.yaml'));

// ── Security, Optimization & Logging ───────────────────────────────────────────
const compression = require('compression');

/*
app.use(helmet({
  crossOriginResourcePolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
}));
*/
app.use(compression());
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
app.use(cors({
  origin: corsOrigin.includes(',') ? corsOrigin.split(',') : corsOrigin,
  credentials: true
}));

// ── Structured Request Logger + Request ID ──────────────────────────────────────
// Replaces morgan. Adds: X-Request-Id header, structured JSON logs,
// slow endpoint warnings (> SLOW_THRESHOLD_MS env var, default 500ms).
app.use(requestLogger);

// ── Sanitize Inputs ──────────────────────────────────────────────────────────
const sanitizer = require('./middleware/sanitizer');
app.use(sanitizer);

// ── Body Parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── API Documentation (Swagger) ────────────────────────────────────────────────
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// ── Global Rate Limiter ───────────────────────────────────────────────────────
app.use('/api/', globalLimiter);

// ── API Versioning Middleware ─────────────────────────────────────────────────
// Detects version from URL (/api/v1/, /api/v2/) or X-API-Version header.
// Stamps every response with X-API-Version header.
// Adds X-API-Deprecated + X-API-Sunset headers for sunset versions.
app.use('/api/', apiVersion());

// ── Versioned Routers (v1 / v2) ──────────────────────────────────────────────
// routes/v1/index.js  → thin delegation layer over the existing flat routes
// routes/v2/index.js  → scaffold — returns 501 until routes are progressively migrated
app.use('/api/v1', require('./routes/v1'));
app.use('/api/v2', require('./routes/v2'));

// ── Health Check (kept for backward compat — also served by routes/v1) ────────
app.get('/api/v1/health', (req, res) =>
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } })
);


// ── Auth (no middleware) ──────────────────────────────────────────────────────
app.use('/api/v1/auth', require('./routes/auth'));

// ── Public Feed (selective auth inside route file) ────────────────────────────
app.use('/api/v1/public', require('./routes/public'));

// ── Protected Routes ──────────────────────────────────────────────────────────

// Admin
app.use('/api/v1/admin',            require('./routes/admin'));

// Profile
app.use('/api/v1/profile',          auth, require('./routes/profile'));

// Settings (persistent user preferences)
app.use('/api/v1/settings',         auth, require('./routes/settings'));


// Home / Summary
app.use('/api/v1/home',             auth, require('./routes/home'));

// Core Finance
app.use('/api/v1/accounts',         auth, require('./routes/accounts'));
app.use('/api/v1/transactions',     auth, require('./routes/transactions'));
app.use('/api/v1/income',           auth, require('./routes/income'));
app.use('/api/v1/expenses',         auth, require('./routes/expenses'));
app.use('/api/v1/budgets',          auth, require('./routes/budgets'));
app.use('/api/v1/savings',          auth, require('./routes/savings'));
app.use('/api/v1/investments',      auth, require('./routes/investments'));
app.use('/api/v1/debts',            auth, require('./routes/debts'));
app.use('/api/v1/planned-payments', auth, require('./routes/plannedPayments'));
app.use('/api/v1/goal-wallets',    auth, require('./routes/goalWallet'));

// Books Module — Stock
app.use('/api/v1/stock',            auth, require('./routes/stock'));

// Financial Plans
// IMPORTANT: static segments (/calendar) and nested param routes BEFORE the parent (/financial-plans)
app.use('/api/v1/financial-plans/calendar',                auth, require('./routes/financialCalendar'));
app.use('/api/v1/financial-plans/:planId/budgets',         auth, require('./routes/planBudget'));
app.use('/api/v1/financial-plans/:planId/income',          auth, require('./routes/planIncome'));
app.use('/api/v1/financial-plans/:planId/expenses',        auth, require('./routes/planExpense'));
app.use('/api/v1/financial-plans/:planId/goals',           auth, require('./routes/planGoals'));
app.use('/api/v1/financial-plans/:planId/reminders',       auth, require('./routes/planReminders'));
app.use('/api/v1/financial-plans/:planId/analysis',        auth, require('./routes/planAnalysis'));
app.use('/api/v1/financial-plans',                         auth, require('./routes/financialPlan'));

// People — nested routes BEFORE parent
app.use('/api/v1/people/:personId/transactions',  auth, require('./routes/peopleTransactions'));
app.use('/api/v1/people/:personId/reminders',     auth, require('./routes/peopleReminders'));
app.use('/api/v1/people/:personId/records',       auth, require('./routes/peopleRecords'));
app.use('/api/v1/people',                         auth, require('./routes/people'));

// Contacts, Segregation, Split Expenses
app.use('/api/v1/contacts',         auth, require('./routes/contacts'));
app.use('/api/v1/segregation',      auth, require('./routes/segregation'));
app.use('/api/v1/split-expenses',   auth, require('./routes/splitExpense'));

// ── 404 Handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` }
  });
});

// ── Global Error Handler (must be last) ───────────────────────────────────────
app.use(errorHandler);

module.exports = app;
