const db = require('../db/connection');
const { sendSuccess } = require('../utils/response');

const getDashboard = async (req, res) => {
  const userId = req.user.id;

  // Total Balance across all accounts
  const accounts = await db.prepare('SELECT * FROM accounts WHERE user_id = ?').all(userId);
  const totalBalance = accounts.reduce((sum, a) => sum + (a.balance || 0), 0);

  // Monthly Income
  const monthlyIncomeObj = await db.prepare(
    `SELECT SUM(amount) as total FROM income WHERE user_id = ? AND strftime('%Y-%m', date) = strftime('%Y-%m', 'now')`
  ).get(userId);
  const monthlyIncome = monthlyIncomeObj?.total || 0;

  // Monthly Expenses
  const monthlyExpensesObj = await db.prepare(
    `SELECT SUM(amount) as total FROM expenses WHERE user_id = ? AND strftime('%Y-%m', date) = strftime('%Y-%m', 'now')`
  ).get(userId);
  const monthlyExpenses = monthlyExpensesObj?.total || 0;

  // Total Savings (current amounts)
  const totalSavingsObj = await db.prepare(
    `SELECT SUM(current_amount) as total FROM savings WHERE user_id = ?`
  ).get(userId);
  const totalSavings = totalSavingsObj?.total || 0;

  // Net Debt outstanding
  const totalDebtsObj = await db.prepare(
    `SELECT SUM(amount - amount_paid) as total FROM debts WHERE user_id = ?`
  ).get(userId);
  const totalDebts = totalDebtsObj?.total || 0;

  // Total Investment current value
  const totalInvestmentsObj = await db.prepare(
    `SELECT SUM(current_value) as total FROM investments WHERE user_id = ?`
  ).get(userId);
  const totalInvestments = totalInvestmentsObj?.total || 0;

  // Total Invested Amount (Cost Basis)
  const totalInvestedAmountObj = await db.prepare(
    `SELECT SUM(amount_invested) as total FROM investments WHERE user_id = ?`
  ).get(userId);
  const totalInvestedAmount = totalInvestedAmountObj?.total || 0;

  // 5 most recent transactions
  const recentTransactions = await db.prepare(`
    SELECT t.*, a.name as account_name 
    FROM transactions t
    LEFT JOIN accounts a ON t.account_id = a.id
    WHERE t.user_id = ?
    ORDER BY t.created_at DESC
    LIMIT 5
  `).all(userId);

  // Receivables (lent to people)
  const totalReceivablesObj = await db.prepare(
    `SELECT SUM(amount) as total FROM people_transactions WHERE user_id = ? AND type = 'lent' AND (status != 'settled' OR status IS NULL)`
  ).get(userId);
  const totalReceivables = totalReceivablesObj?.total || 0;

  // Payables (borrowed from people)
  const totalPayablesObj = await db.prepare(
    `SELECT SUM(amount) as total FROM people_transactions WHERE user_id = ? AND type = 'borrowed' AND (status != 'settled' OR status IS NULL)`
  ).get(userId);
  const totalPayables = totalPayablesObj?.total || 0;

  return sendSuccess(res, {
    totalBalance,
    monthlyIncome,
    monthlyExpenses,
    netSavingsThisMonth: monthlyIncome - monthlyExpenses,
    totalSavings,
    totalDebts,
    totalInvestments,
    totalInvestedAmount,
    totalReceivables,
    totalPayables,
    recentTransactions,
    accounts,
  });
};

const getWidgets = async (req, res) => {
  const user = await db.prepare('SELECT widgets FROM users WHERE id = ?').get(req.user.id);
  const widgets = user?.widgets ? JSON.parse(user.widgets) : [];
  return sendSuccess(res, widgets);
};

const updateWidgets = async (req, res) => {
  const { widgets } = req.body;
  
  if (!Array.isArray(widgets)) {
    return sendError(res, 'Widgets must be an array', 400, 'BAD_REQUEST');
  }

  await db.prepare('UPDATE users SET widgets = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(widgets), new Date().toISOString(), req.user.id);
  
  return sendSuccess(res, widgets, 'Widgets updated');
};

module.exports = { getDashboard, getWidgets, updateWidgets };
