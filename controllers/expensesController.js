const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { paginate } = require('../utils/pagination');

const getExpenses = async (req, res) => {
  const { category, is_recurring, from, to, page, limit, sort = 'created_at', order = 'desc', search } = req.query;
  let query = 'SELECT * FROM expenses WHERE user_id = ?';
  const params = [req.user.id];

  if (category) { query += ' AND category LIKE ?'; params.push(`%${category}%`); }
  if (is_recurring !== undefined) { query += ' AND is_recurring = ?'; params.push(Number(is_recurring)); }
  if (search) { query += ' AND (description LIKE ? OR category LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  if (from) { query += ' AND date >= ?'; params.push(from); }
  if (to) { query += ' AND date <= ?'; params.push(to); }

  const allowedSorts = ['created_at', 'updated_at', 'date', 'amount'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'created_at';
  const sortDir = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  query += ` ORDER BY ${sortCol} ${sortDir}`;

  const result = await paginate(query, params, page, limit, db);
  return sendSuccess(res, result.rows, 'Expenses fetched', 200, result.meta);
};

const createExpense = async (req, res) => {
  const { account_id, category, amount, description, date, is_recurring = 0 } = req.body;
  if (amount === undefined) return sendError(res, 'Amount is required', 400, 'BAD_REQUEST');

  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO expenses (user_id, account_id, category, amount, description, date, is_recurring, created_at, updated_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = await stmt.run(req.user.id, account_id || null, category || null, amount, description || null, date || now, is_recurring ? 1 : 0, now, now);
  
  if (account_id) {
    db.prepare('UPDATE accounts SET balance = balance - ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .run(amount, now, account_id, req.user.id);
  }
  
  const newItem = await db.prepare('SELECT * FROM expenses WHERE id = ?').get(info.lastInsertRowid);
  return sendSuccess(res, newItem, 'Expense created', 201);
};

const getExpense = async (req, res) => {
  const item = await db.prepare('SELECT * FROM expenses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Expense not found', 404, 'NOT_FOUND');
  return sendSuccess(res, item);
};

const updateExpense = async (req, res) => {
  const item = await db.prepare('SELECT * FROM expenses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Expense not found', 404, 'NOT_FOUND');

  const updates = [];
  const params = [];
  const allowedFields = ['account_id', 'category', 'amount', 'description', 'date', 'is_recurring'];
  
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      params.push(field === 'is_recurring' ? (req.body[field] ? 1 : 0) : req.body[field]);
    }
  }

  if (updates.length > 0) {
    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(req.params.id, req.user.id);
    await db.prepare(`UPDATE expenses SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
  }
  
  const updatedItem = await db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  return sendSuccess(res, updatedItem, 'Expense updated');
};

const deleteExpense = async (req, res) => {
  const item = await db.prepare('SELECT * FROM expenses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Expense not found', 404, 'NOT_FOUND');

  await db.prepare('DELETE FROM expenses WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  return res.status(204).end();
};

module.exports = { getExpenses, createExpense, getExpense, updateExpense, deleteExpense };
