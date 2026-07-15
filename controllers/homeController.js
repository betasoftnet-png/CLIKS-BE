const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

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

  // ── NEW ENHANCED METRICS ──

  // Properties Assets
  const totalPropertyValObj = await db.prepare(
    `SELECT SUM(security_deposit) as total FROM property_records WHERE user_id = ?`
  ).get(userId);
  const totalPropertyAssets = totalPropertyValObj?.total || 0;

  // Loans (Liabilities)
  const totalLoansObj = await db.prepare(
    `SELECT SUM(amount - amount_paid) as total FROM debts WHERE user_id = ?`
  ).get(userId);
  const totalLiabilities = (totalLoansObj?.total || 0) + totalPayables;

  // Net Worth Calculation
  const totalAssets = totalBalance + totalInvestments + totalPropertyAssets + totalReceivables;
  const netWorth = totalAssets - totalLiabilities;

  // Investment Stats (Monthly P/L placeholder or simplified)
  // For monthly P/L we'd need historical snapshots, but we can return total profit
  const totalInvestmentProfit = totalInvestments - totalInvestedAmount;
  const overallReturnPct = totalInvestedAmount > 0 ? (totalInvestmentProfit / totalInvestedAmount) * 100 : 0;

  // Tax Summary
  const taxRecord = await db.prepare(
    `SELECT * FROM tax_records WHERE user_id = ? ORDER BY tax_year DESC LIMIT 1`
  ).get(userId);

  const taxDue = {
    estimated: taxRecord?.income_tax || 0,
    paid: taxRecord?.tds_paid || 0,
    remaining: Math.max(0, (taxRecord?.income_tax || 0) - (taxRecord?.tds_paid || 0)),
    refund: Math.max(0, (taxRecord?.tds_paid || 0) - (taxRecord?.income_tax || 0))
  };

  // User Profile for Role
  const userRow = await db.prepare('SELECT primary_income_source, global_budget FROM users WHERE id = ?').get(userId);

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
    // Enhanced
    netWorth,
    totalAssets,
    totalLiabilities,
    investmentStats: {
      total: totalInvestments,
      profit: totalInvestmentProfit,
      returnPct: overallReturnPct
    },
    taxSummary: taxDue,
    primaryIncomeSource: userRow?.primary_income_source,
    globalBudget: userRow?.global_budget || 20000
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

const getBooksDashboard = async (req, res) => {
  const userId = req.user.id;
  console.log('Books Dashboard requested for user:', userId);

  // Stock / Assets info
  const stockInfo = await db.prepare(
    `SELECT COUNT(*) as totalItems, COUNT(*) as totalitems, COALESCE(SUM(quantity * unit_price), 0) as totalValue, COALESCE(SUM(quantity * unit_price), 0) as totalvalue FROM stock WHERE user_id = ?`
  ).get(userId);
  console.log('Stock query result:', stockInfo);

  // Fallback / Combine with Inventory table too
  const invInfo = await db.prepare(
    `SELECT COUNT(*) as totalItems, COUNT(*) as totalitems, COALESCE(SUM(quantity * price), 0) as totalValue, COALESCE(SUM(quantity * price), 0) as totalvalue FROM inventory WHERE user_id = ?`
  ).get(userId);
  console.log('Inventory query result:', invInfo);

  const totalItems = Number(stockInfo?.totalItems || stockInfo?.totalitems || 0) +
                     Number(invInfo?.totalItems || invInfo?.totalitems || 0);

  const totalValue = Number(stockInfo?.totalValue || stockInfo?.totalvalue || 0) +
                     Number(invInfo?.totalValue || invInfo?.totalvalue || 0);

  // Financial Plans info
  const plansInfo = await db.prepare(
    `SELECT COUNT(*) as total FROM financial_plans WHERE user_id = ?`
  ).get(userId);
  console.log('Plans query result:', plansInfo);

  // People info
  const peopleInfo = await db.prepare(
    `SELECT COUNT(*) as total FROM people WHERE user_id = ?`
  ).get(userId);
  console.log('People query result:', peopleInfo);

  // Goal Wallets info
  const walletsInfo = await db.prepare(
    `SELECT COUNT(*) as total, COALESCE(SUM(current_amount), 0) as saved FROM goal_wallets WHERE user_id = ?`
  ).get(userId);
  console.log('Wallets query result:', walletsInfo);

  // Split Expenses info
  const splitsInfo = await db.prepare(
    `SELECT COUNT(*) as total, COALESCE(SUM(total_amount), 0) as totalAmount, COALESCE(SUM(total_amount), 0) as totalamount FROM split_expenses WHERE user_id = ?`
  ).get(userId);
  console.log('Splits query result:', splitsInfo);

  // Recent Stock items for display
  const recentStock = await db.prepare(
    `SELECT * FROM stock WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`
  ).all(userId);

  return sendSuccess(res, {
    stock: {
      totalItems,
      totalValue,
    },
    plans: {
      total: Number(plansInfo?.total || plansInfo?.Total || 0),
    },
    people: {
      total: Number(peopleInfo?.total || peopleInfo?.Total || 0),
    },
    wallets: {
      total: Number(walletsInfo?.total || walletsInfo?.Total || 0),
      saved: Number(walletsInfo?.saved || walletsInfo?.Saved || 0),
    },
    splits: {
      total: Number(splitsInfo?.total || splitsInfo?.Total || 0),
      totalAmount: Number(splitsInfo?.totalAmount || splitsInfo?.totalamount || 0),
    },
    recentStock
  });
};

module.exports = { getDashboard, getWidgets, updateWidgets, getBooksDashboard };
