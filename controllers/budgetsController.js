const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { paginate } = require('../utils/pagination');

const getBudgets = async (req, res) => {
  const { category, period, page, limit, sort = 'created_at', order = 'desc', search } = req.query;
  let query = 'SELECT * FROM budgets WHERE user_id = ?';
  const params = [req.user.id];

  if (category) { query += ' AND category LIKE ?'; params.push(`%${category}%`); }
  if (period) { query += ' AND period = ?'; params.push(period); }
  if (search) { query += ' AND category LIKE ?'; params.push(`%${search}%`); }

  const allowedSorts = ['created_at', 'updated_at', 'amount_limit', 'amount_spent', 'start_date', 'end_date'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'created_at';
  const sortDir = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  query += ` ORDER BY ${sortCol} ${sortDir}`;

  const result = await paginate(query, params, page, limit, db);
  return sendSuccess(res, result.rows, 'Budgets fetched', 200, result.meta);
};

const createBudget = async (req, res) => {
  const { category, amount_limit, amount_spent = 0, period = 'monthly', start_date, end_date } = req.body;
  if (!category || amount_limit === undefined) return sendError(res, 'Category and amount_limit are required', 400, 'BAD_REQUEST');

  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO budgets (user_id, category, amount_limit, amount_spent, period, start_date, end_date, created_at, updated_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = await stmt.run(req.user.id, category, amount_limit, amount_spent, period, start_date || null, end_date || null, now, now);
  
  const newItem = await db.prepare('SELECT * FROM budgets WHERE id = ?').get(info.lastInsertRowid);
  return sendSuccess(res, newItem, 'Budget created', 201);
};

const getBudget = async (req, res) => {
  const item = await db.prepare('SELECT * FROM budgets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Budget not found', 404, 'NOT_FOUND');
  return sendSuccess(res, item);
};

const updateBudget = async (req, res) => {
  const item = await db.prepare('SELECT * FROM budgets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Budget not found', 404, 'NOT_FOUND');

  const updates = [];
  const params = [];
  const allowedFields = ['category', 'amount_limit', 'amount_spent', 'period', 'start_date', 'end_date'];
  
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
    await db.prepare(`UPDATE budgets SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
  }
  
  const updatedItem = await db.prepare('SELECT * FROM budgets WHERE id = ?').get(req.params.id);
  return sendSuccess(res, updatedItem, 'Budget updated');
};

const spendBudget = async (req, res) => {
  const { amount } = req.body;
  if (amount === undefined) return sendError(res, 'Amount is required', 400, 'BAD_REQUEST');

  const item = await db.prepare('SELECT * FROM budgets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Budget not found', 404, 'NOT_FOUND');

  const now = new Date().toISOString();
  await db.prepare(`UPDATE budgets SET amount_spent = amount_spent + ?, updated_at = ? WHERE id = ? AND user_id = ?`)
    .run(amount, now, req.params.id, req.user.id);

  const updatedItem = await db.prepare('SELECT * FROM budgets WHERE id = ?').get(req.params.id);
  return sendSuccess(res, updatedItem, 'Spent amount updated');
};

const deleteBudget = async (req, res) => {
  const item = await db.prepare('SELECT * FROM budgets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Budget not found', 404, 'NOT_FOUND');

  await db.prepare('DELETE FROM budgets WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  return res.status(204).end();
};

module.exports = { getBudgets, createBudget, getBudget, updateBudget, spendBudget, deleteBudget };
