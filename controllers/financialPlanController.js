const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { paginate } = require('../utils/pagination');

const getPlans = async (req, res) => {
  const { status, page, limit, sort = 'created_at', order = 'desc', search, from, to } = req.query;
  let query = 'SELECT * FROM financial_plans WHERE user_id = ?';
  const params = [req.user.id];

  if (status) { query += ' AND status = ?'; params.push(status); }
  if (search) { query += ' AND (title LIKE ? OR description LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  if (from) { query += ' AND start_date >= ?'; params.push(from); }
  if (to) { query += ' AND end_date <= ?'; params.push(to); }

  const allowedSorts = ['created_at', 'updated_at', 'title', 'start_date', 'end_date'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'created_at';
  const sortDir = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  query += ` ORDER BY ${sortCol} ${sortDir}`;

  const result = await paginate(query, params, page, limit, db);
  return sendSuccess(res, result.rows, 'Financial plans fetched', 200, result.meta);
};

const createPlan = async (req, res) => {
  const { title, description, start_date, end_date, status = 'draft' } = req.body;
  if (!title) return sendError(res, 'Title is required', 400, 'BAD_REQUEST');

  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO financial_plans (user_id, title, description, start_date, end_date, status, created_at, updated_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = await stmt.run(req.user.id, title, description || null, start_date || null, end_date || null, status, now, now);
  
  const newItem = await db.prepare('SELECT * FROM financial_plans WHERE id = ?').get(info.lastInsertRowid);
  return sendSuccess(res, newItem, 'Financial plan created', 201);
};

const getPlan = async (req, res) => {
  const plan = await db.prepare('SELECT * FROM financial_plans WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!plan) return sendError(res, 'Financial plan not found', 404, 'NOT_FOUND');

  const budCount = await db.prepare('SELECT COUNT(*) as c FROM plan_budgets WHERE plan_id = ? AND user_id = ?').get(plan.id, req.user.id).c;
  const goalCount = await db.prepare('SELECT COUNT(*) as c FROM plan_goals WHERE plan_id = ? AND user_id = ?').get(plan.id, req.user.id).c;
  const remCount = await db.prepare('SELECT COUNT(*) as c FROM plan_reminders WHERE plan_id = ? AND user_id = ?').get(plan.id, req.user.id).c;

  plan.budgets_count = budCount;
  plan.goals_count = goalCount;
  plan.reminders_count = remCount;

  return sendSuccess(res, plan);
};

const updatePlan = async (req, res) => {
  const plan = await db.prepare('SELECT * FROM financial_plans WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!plan) return sendError(res, 'Financial plan not found', 404, 'NOT_FOUND');

  const updates = [];
  const params = [];
  const allowedFields = ['title', 'description', 'start_date', 'end_date', 'status'];
  
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      params.push(req.body[field]);
    }
  }

  if (updates.length > 0) {
    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(req.params.id, req.user.id);
    await db.prepare(`UPDATE financial_plans SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
  }
  
  const updatedItem = await db.prepare('SELECT * FROM financial_plans WHERE id = ?').get(req.params.id);
  return sendSuccess(res, updatedItem, 'Financial plan updated');
};

const deletePlan = async (req, res) => {
  const plan = await db.prepare('SELECT * FROM financial_plans WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!plan) return sendError(res, 'Financial plan not found', 404, 'NOT_FOUND');

  const deletePlanTx = db.transaction(async () => {
    const pId = req.params.id;
    const uId = req.user.id;
    await db.prepare('DELETE FROM plan_budgets WHERE plan_id = ? AND user_id = ?').run(pId, uId);
    await db.prepare('DELETE FROM plan_income WHERE plan_id = ? AND user_id = ?').run(pId, uId);
    await db.prepare('DELETE FROM plan_expenses WHERE plan_id = ? AND user_id = ?').run(pId, uId);
    await db.prepare('DELETE FROM plan_goals WHERE plan_id = ? AND user_id = ?').run(pId, uId);
    await db.prepare('DELETE FROM plan_reminders WHERE plan_id = ? AND user_id = ?').run(pId, uId);
    await db.prepare('DELETE FROM financial_plans WHERE id = ? AND user_id = ?').run(pId, uId);
  });

  await deletePlanTx();
  return res.status(204).end();
};

module.exports = { getPlans, createPlan, getPlan, updatePlan, deletePlan };
