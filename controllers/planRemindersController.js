const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { paginate } = require('../utils/pagination');

// Middleware: Verify plan ownership
const verifyPlan = async (req, res, next) => {
  const plan = await db.prepare('SELECT * FROM financial_plans WHERE id = ? AND user_id = ?').get(req.params.planId, req.user.id);
  if (!plan) return sendError(res, 'Financial plan not found', 404, 'NOT_FOUND');
  next();
};

const getPlanReminders = async (req, res) => {
  const { page, limit, sort = 'due_date', order = 'asc', search, status } = req.query;
  let query = 'SELECT * FROM plan_reminders WHERE plan_id = ? AND user_id = ?';
  const params = [req.params.planId, req.user.id];

  if (status) { query += ' AND status = ?'; params.push(status); }
  if (search) { query += ' AND (title LIKE ? OR message LIKE ? OR type LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }

  const allowedSorts = ['created_at', 'updated_at', 'title', 'due_date', 'type'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'created_at';
  const sortDir = order.toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  query += ` ORDER BY ${sortCol} ${sortDir}`;

  const result = await paginate(query, params, page, limit, db);
  return sendSuccess(res, result.rows, 'Plan reminders fetched', 200, result.meta);
};

const createPlanReminder = async (req, res) => {
  // Accept 'message' (schema column) or 'description' (alias)
  const { title, message, description, due_date, type, status = 'pending' } = req.body;
  const messageText = message || description || null;
  if (!title || !due_date || !type) return sendError(res, 'Title, due_date, and type are required', 400, 'BAD_REQUEST');

  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO plan_reminders (plan_id, user_id, title, message, due_date, type, status, created_at, updated_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = await stmt.run(req.params.planId, req.user.id, title, messageText, due_date, type, status, now, now);
  
  const newItem = await db.prepare('SELECT * FROM plan_reminders WHERE id = ?').get(info.lastInsertRowid);
  return sendSuccess(res, newItem, 'Plan reminder created', 201);
};

const getPlanReminder = async (req, res) => {
  const item = await db.prepare('SELECT * FROM plan_reminders WHERE id = ? AND plan_id = ? AND user_id = ?').get(req.params.id, req.params.planId, req.user.id);
  if (!item) return sendError(res, 'Plan reminder not found', 404, 'NOT_FOUND');
  return sendSuccess(res, item);
};

const updatePlanReminder = async (req, res) => {
  const item = await db.prepare('SELECT * FROM plan_reminders WHERE id = ? AND plan_id = ? AND user_id = ?').get(req.params.id, req.params.planId, req.user.id);
  if (!item) return sendError(res, 'Plan reminder not found', 404, 'NOT_FOUND');

  const updates = [];
  const params = [];
  const allowedFields = ['title', 'message', 'due_date', 'type', 'status'];
  
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      params.push(req.body[field]);
    } else if (field === 'message' && req.body.description !== undefined) {
      // Accept 'description' as alias for 'message'
      updates.push(`message = ?`);
      params.push(req.body.description);
    }
  }

  if (updates.length > 0) {
    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(req.params.id, req.params.planId, req.user.id);
    await db.prepare(`UPDATE plan_reminders SET ${updates.join(', ')} WHERE id = ? AND plan_id = ? AND user_id = ?`).run(...params);
  }
  
  const updatedItem = await db.prepare('SELECT * FROM plan_reminders WHERE id = ?').get(req.params.id);
  return sendSuccess(res, updatedItem, 'Plan reminder updated');
};

const deletePlanReminder = async (req, res) => {
  const item = await db.prepare('SELECT * FROM plan_reminders WHERE id = ? AND plan_id = ? AND user_id = ?').get(req.params.id, req.params.planId, req.user.id);
  if (!item) return sendError(res, 'Plan reminder not found', 404, 'NOT_FOUND');

  await db.prepare('DELETE FROM plan_reminders WHERE id = ? AND plan_id = ? AND user_id = ?').run(req.params.id, req.params.planId, req.user.id);
  return res.status(204).end();
};

module.exports = { verifyPlan, getPlanReminders, createPlanReminder, getPlanReminder, updatePlanReminder, deletePlanReminder };
