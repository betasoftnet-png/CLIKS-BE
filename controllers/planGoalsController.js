const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { paginate } = require('../utils/pagination');

// Middleware: Verify plan ownership
const verifyPlan = async (req, res, next) => {
  const plan = await db.prepare('SELECT * FROM financial_plans WHERE id = ? AND user_id = ?').get(req.params.planId, req.user.id);
  if (!plan) return sendError(res, 'Financial plan not found', 404, 'NOT_FOUND');
  next();
};

const getPlanGoals = async (req, res) => {
  const { page, limit, sort = 'created_at', order = 'desc', search, status } = req.query;
  let query = 'SELECT * FROM plan_goals WHERE plan_id = ? AND user_id = ?';
  const params = [req.params.planId, req.user.id];

  if (status) { query += ' AND status = ?'; params.push(status); }
  if (search) { query += ' AND (title LIKE ? OR notes LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

  const allowedSorts = ['created_at', 'updated_at', 'name', 'target_amount', 'current_amount', 'deadline'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'created_at';
  const sortDir = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  query += ` ORDER BY ${sortCol} ${sortDir}`;

  const result = await paginate(query, params, page, limit, db);
  return sendSuccess(res, result.rows, 'Plan goals fetched', 200, result.meta);
};

const createPlanGoal = async (req, res) => {
  const { name, title, description, target_amount, current_amount = 0, deadline, status = 'in_progress', notes } = req.body;
  const goalTitle = title || name; // accept either field
  if (!goalTitle || target_amount === undefined) return sendError(res, 'Title/name and target_amount are required', 400, 'BAD_REQUEST');

  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO plan_goals (plan_id, user_id, title, name, description, target_amount, current_amount, deadline, status, notes, created_at, updated_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = await stmt.run(req.params.planId, req.user.id, goalTitle, goalTitle, description || null, target_amount, current_amount, deadline || null, status, notes || null, now, now);
  
  const newItem = await db.prepare('SELECT * FROM plan_goals WHERE id = ?').get(info.lastInsertRowid);
  return sendSuccess(res, newItem, 'Plan goal created', 201);
};

const getPlanGoal = async (req, res) => {
  const item = await db.prepare('SELECT * FROM plan_goals WHERE id = ? AND plan_id = ? AND user_id = ?').get(req.params.id, req.params.planId, req.user.id);
  if (!item) return sendError(res, 'Plan goal not found', 404, 'NOT_FOUND');
  return sendSuccess(res, item);
};

const updatePlanGoal = async (req, res) => {
  const item = await db.prepare('SELECT * FROM plan_goals WHERE id = ? AND plan_id = ? AND user_id = ?').get(req.params.id, req.params.planId, req.user.id);
  if (!item) return sendError(res, 'Plan goal not found', 404, 'NOT_FOUND');

  const updates = [];
  const params = [];
  const allowedFields = ['title', 'name', 'description', 'target_amount', 'current_amount', 'deadline', 'status', 'notes'];
  
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
    await db.prepare(`UPDATE plan_goals SET ${updates.join(', ')} WHERE id = ? AND plan_id = ? AND user_id = ?`).run(...params);
  }
  
  const updatedItem = await db.prepare('SELECT * FROM plan_goals WHERE id = ?').get(req.params.id);
  return sendSuccess(res, updatedItem, 'Plan goal updated');
};

const deletePlanGoal = async (req, res) => {
  const item = await db.prepare('SELECT * FROM plan_goals WHERE id = ? AND plan_id = ? AND user_id = ?').get(req.params.id, req.params.planId, req.user.id);
  if (!item) return sendError(res, 'Plan goal not found', 404, 'NOT_FOUND');

  await db.prepare('DELETE FROM plan_goals WHERE id = ? AND plan_id = ? AND user_id = ?').run(req.params.id, req.params.planId, req.user.id);
  return res.status(204).end();
};

module.exports = { verifyPlan, getPlanGoals, createPlanGoal, getPlanGoal, updatePlanGoal, deletePlanGoal };
