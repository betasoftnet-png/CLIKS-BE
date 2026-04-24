const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

// Middleware: Verify plan ownership
const verifyPlan = async (req, res, next) => {
  const plan = await db.prepare('SELECT * FROM financial_plans WHERE id = ? AND user_id = ?').get(req.params.planId, req.user.id);
  if (!plan) return sendError(res, 'Financial plan not found', 404, 'NOT_FOUND');
  next();
};

const getPlanAnalysis = async (req, res) => {
  const pId = req.params.planId;
  const uId = req.user.id;

  const expectedIncomeRow = await db.prepare('SELECT SUM(expected_amount) as total FROM plan_income WHERE plan_id = ? AND user_id = ?').get(pId, uId);
  const total_expected_income = expectedIncomeRow.total || 0;

  const actualIncomeRow = await db.prepare('SELECT SUM(actual_amount) as total FROM plan_income WHERE plan_id = ? AND user_id = ?').get(pId, uId);
  const total_actual_income = actualIncomeRow.total || 0;

  const allocatedBudgetRow = await db.prepare('SELECT SUM(allocated_amount) as total FROM plan_budgets WHERE plan_id = ? AND user_id = ?').get(pId, uId);
  const total_allocated_budget = allocatedBudgetRow.total || 0;

  const spentBudgetRow = await db.prepare('SELECT SUM(spent_amount) as total FROM plan_budgets WHERE plan_id = ? AND user_id = ?').get(pId, uId);
  const total_spent_budget = spentBudgetRow.total || 0;

  const expectedExpensesRow = await db.prepare('SELECT SUM(expected_amount) as total FROM plan_expenses WHERE plan_id = ? AND user_id = ?').get(pId, uId);
  const total_expected_expenses = expectedExpensesRow.total || 0;

  const actualExpensesRow = await db.prepare('SELECT SUM(actual_amount) as total FROM plan_expenses WHERE plan_id = ? AND user_id = ?').get(pId, uId);
  const total_actual_expenses = actualExpensesRow.total || 0;

  return sendSuccess(res, {
    total_expected_income,
    total_actual_income,
    total_allocated_budget,
    total_spent_budget,
    total_expected_expenses,
    total_actual_expenses
  }, 'Plan analysis fetched');
};

module.exports = { verifyPlan, getPlanAnalysis };
