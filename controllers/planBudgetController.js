const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { paginate } = require('../utils/pagination');

// Middleware: Verify plan ownership
const verifyPlan = async (req, res, next) => {
  const plan = await db.prepare('SELECT * FROM financial_plans WHERE id = ? AND user_id = ?').get(req.params.planId, req.user.id);
  if (!plan) return sendError(res, 'Financial plan not found', 404, 'NOT_FOUND');
  next();
};

const getPlanBudgets = async (req, res) => {
  const { page, limit, sort = 'created_at', order = 'desc', search } = req.query;
  let query = 'SELECT * FROM plan_budgets WHERE plan_id = ? AND user_id = ?';
  const params = [req.params.planId, req.user.id];

  if (search) { query += ' AND category LIKE ?'; params.push(`%${search}%`); }

  const allowedSorts = ['created_at', 'updated_at', 'category', 'allocated_amount', 'spent_amount'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'created_at';
  const sortDir = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  query += ` ORDER BY ${sortCol} ${sortDir}`;

  const result = await paginate(query, params, page, limit, db);
  return sendSuccess(res, result.rows, 'Plan budgets fetched', 200, result.meta);
};

const createPlanBudget = async (req, res) => {
  const { category, allocated_amount, spent_amount = 0, notes } = req.body;
  if (!category || allocated_amount === undefined) return sendError(res, 'Category and allocated_amount are required', 400, 'BAD_REQUEST');

  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO plan_budgets (plan_id, user_id, category, allocated_amount, spent_amount, notes, created_at, updated_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = await stmt.run(req.params.planId, req.user.id, category, allocated_amount, spent_amount, notes || null, now, now);
  
  const newItem = await db.prepare('SELECT * FROM plan_budgets WHERE id = ?').get(info.lastInsertRowid);
  return sendSuccess(res, newItem, 'Plan budget created', 201);
};

const getPlanBudget = async (req, res) => {
  const item = await db.prepare('SELECT * FROM plan_budgets WHERE id = ? AND plan_id = ? AND user_id = ?').get(req.params.id, req.params.planId, req.user.id);
  if (!item) return sendError(res, 'Plan budget not found', 404, 'NOT_FOUND');
  return sendSuccess(res, item);
};

const updatePlanBudget = async (req, res) => {
  const item = await db.prepare('SELECT * FROM plan_budgets WHERE id = ? AND plan_id = ? AND user_id = ?').get(req.params.id, req.params.planId, req.user.id);
  if (!item) return sendError(res, 'Plan budget not found', 404, 'NOT_FOUND');

  const updates = [];
  const params = [];
  const allowedFields = ['category', 'allocated_amount', 'spent_amount', 'notes'];
  
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
    await db.prepare(`UPDATE plan_budgets SET ${updates.join(', ')} WHERE id = ? AND plan_id = ? AND user_id = ?`).run(...params);
  }
  
  const updatedItem = await db.prepare('SELECT * FROM plan_budgets WHERE id = ?').get(req.params.id);
  return sendSuccess(res, updatedItem, 'Plan budget updated');
};

const deletePlanBudget = async (req, res) => {
  const item = await db.prepare('SELECT * FROM plan_budgets WHERE id = ? AND plan_id = ? AND user_id = ?').get(req.params.id, req.params.planId, req.user.id);
  if (!item) return sendError(res, 'Plan budget not found', 404, 'NOT_FOUND');

  await db.prepare('DELETE FROM plan_budgets WHERE id = ? AND plan_id = ? AND user_id = ?').run(req.params.id, req.params.planId, req.user.id);
  return res.status(204).end();
};

module.exports = { verifyPlan, getPlanBudgets, createPlanBudget, getPlanBudget, updatePlanBudget, deletePlanBudget };
