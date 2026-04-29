const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { paginate } = require('../utils/pagination');

// Middleware: Verify plan ownership
const verifyPlan = async (req, res, next) => {
  const plan = await db.prepare('SELECT * FROM financial_plans WHERE id = ? AND user_id = ?').get(req.params.planId, req.user.id);
  if (!plan) return sendError(res, 'Financial plan not found', 404, 'NOT_FOUND');
  next();
};

const getPlanExpenses = async (req, res) => {
  const { page, limit, sort = 'created_at', order = 'desc', search, category } = req.query;
  let query = 'SELECT * FROM plan_expenses WHERE plan_id = ? AND user_id = ?';
  const params = [req.params.planId, req.user.id];

  if (category) { query += ' AND category = ?'; params.push(category); }
  if (search) { query += ' AND (description LIKE ? OR notes LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

  const allowedSorts = ['created_at', 'updated_at', 'category', 'expected_amount', 'actual_amount'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'created_at';
  const sortDir = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  query += ` ORDER BY ${sortCol} ${sortDir}`;

  const result = await paginate(query, params, page, limit, db);
  return sendSuccess(res, result.rows, 'Plan expenses fetched', 200, result.meta);
};

const createPlanExpense = async (req, res) => {
  const { category, description, item, expected_amount, actual_amount = 0, notes } = req.body;
  const finalDescription = description || item;
  
  if (!category || expected_amount === undefined) return sendError(res, 'Category and expected_amount are required', 400, 'BAD_REQUEST');

  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO plan_expenses (plan_id, user_id, category, description, expected_amount, actual_amount, notes, created_at, updated_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = await stmt.run(req.params.planId, req.user.id, category, finalDescription || null, expected_amount, actual_amount, notes || null, now, now);
  
  const newItem = await db.prepare('SELECT * FROM plan_expenses WHERE id = ?').get(info.lastInsertRowid);
  return sendSuccess(res, newItem, 'Plan expense created', 201);
};

const getPlanExpense = async (req, res) => {
  const item = await db.prepare('SELECT * FROM plan_expenses WHERE id = ? AND plan_id = ? AND user_id = ?').get(req.params.id, req.params.planId, req.user.id);
  if (!item) return sendError(res, 'Plan expense not found', 404, 'NOT_FOUND');
  return sendSuccess(res, item);
};

const updatePlanExpense = async (req, res) => {
  const item = await db.prepare('SELECT * FROM plan_expenses WHERE id = ? AND plan_id = ? AND user_id = ?').get(req.params.id, req.params.planId, req.user.id);
  if (!item) return sendError(res, 'Plan expense not found', 404, 'NOT_FOUND');

  const updates = [];
  const params = [];
  const allowedFields = ['category', 'description', 'expected_amount', 'actual_amount', 'notes'];
  
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      params.push(req.body[field]);
    }
  }

  if (updates.length > 0) {
    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(req.params.id, req.params.planId, req.user.id);
    await db.prepare(`UPDATE plan_expenses SET ${updates.join(', ')} WHERE id = ? AND plan_id = ? AND user_id = ?`).run(...params);
  }
  
  const updatedItem = await db.prepare('SELECT * FROM plan_expenses WHERE id = ?').get(req.params.id);
  return sendSuccess(res, updatedItem, 'Plan expense updated');
};

const deletePlanExpense = async (req, res) => {
  const item = await db.prepare('SELECT * FROM plan_expenses WHERE id = ? AND plan_id = ? AND user_id = ?').get(req.params.id, req.params.planId, req.user.id);
  if (!item) return sendError(res, 'Plan expense not found', 404, 'NOT_FOUND');

  await db.prepare('DELETE FROM plan_expenses WHERE id = ? AND plan_id = ? AND user_id = ?').run(req.params.id, req.params.planId, req.user.id);
  return res.status(204).end();
};

module.exports = { verifyPlan, getPlanExpenses, createPlanExpense, getPlanExpense, updatePlanExpense, deletePlanExpense };
