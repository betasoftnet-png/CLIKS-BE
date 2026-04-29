const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

// Middleware: Verify plan ownership
const verifyPlan = async (req, res, next) => {
  try {
    const plan = await db.prepare('SELECT * FROM financial_plans WHERE id = ? AND user_id = ?').get(req.params.planId, req.user.id);
    if (!plan) return sendError(res, 'Financial plan not found', 404, 'NOT_FOUND');
    next();
  } catch (err) {
    console.error('[verifyPlan] Error:', err);
    next(err);
  }
};

const getPlanAnalysis = async (req, res, next) => {
  try {
    const pId = req.params.planId;
    const uId = req.user.id;

    // 1. Basic Aggregates
    const expectedIncomeRow = await db.prepare('SELECT SUM(expected_amount) as total FROM plan_income WHERE plan_id = ? AND user_id = ?').get(pId, uId);
    const total_expected_income = expectedIncomeRow?.total || 0;

    const actualIncomeRow = await db.prepare('SELECT SUM(actual_amount) as total FROM plan_income WHERE plan_id = ? AND user_id = ?').get(pId, uId);
    const total_actual_income = actualIncomeRow?.total || 0;

    const allocatedBudgetRow = await db.prepare('SELECT SUM(allocated_amount) as total FROM plan_budgets WHERE plan_id = ? AND user_id = ?').get(pId, uId);
    const total_allocated_budget = allocatedBudgetRow?.total || 0;

    const spentBudgetRow = await db.prepare('SELECT SUM(spent_amount) as total FROM plan_budgets WHERE plan_id = ? AND user_id = ?').get(pId, uId);
    const total_spent_budget = spentBudgetRow?.total || 0;

    const expectedExpensesRow = await db.prepare('SELECT SUM(expected_amount) as total FROM plan_expenses WHERE plan_id = ? AND user_id = ?').get(pId, uId);
    const total_expected_expenses = expectedExpensesRow?.total || 0;

    const actualExpensesRow = await db.prepare('SELECT SUM(actual_amount) as total FROM plan_expenses WHERE plan_id = ? AND user_id = ?').get(pId, uId);
    const total_actual_expenses = actualExpensesRow?.total || 0;

    // 2. Category Breakdown (for Spending Pulse)
    const categoryBreakdown = await db.prepare(`
      SELECT category, SUM(actual_amount) as total 
      FROM plan_expenses 
      WHERE plan_id = ? AND user_id = ? 
      GROUP BY category 
      ORDER BY total DESC
    `).all(pId, uId);

    // 3. Upcoming Reminders (for Alert Card)
    const now = new Date().toISOString();
    const upcomingReminders = await db.prepare(`
      SELECT * FROM plan_reminders 
      WHERE plan_id = ? AND user_id = ? AND due_date >= ?
      ORDER BY due_date ASC 
      LIMIT 3
    `).all(pId, uId, now);

    return sendSuccess(res, {
      total_expected_income,
      total_actual_income,
      total_allocated_budget,
      total_spent_budget,
      total_expected_expenses,
      total_actual_expenses,
      category_breakdown: categoryBreakdown || [],
      upcoming_reminders: upcomingReminders || []
    }, 'Plan analysis fetched');
  } catch (err) {
    console.error('[getPlanAnalysis] Error:', err);
    next(err);
  }
};

module.exports = { verifyPlan, getPlanAnalysis };
