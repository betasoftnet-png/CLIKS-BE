const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { paginate } = require('../utils/pagination');
const { invalidateUserDashboard } = require('../utils/cacheInvalidation');

const getTransactions = async (req, res) => {
  const { type, account_id, category, from, to, page, limit, sort = 'created_at', order = 'desc', search } = req.query;
  let query = 'SELECT * FROM transactions WHERE user_id = ?';
  const params = [req.user.id];

  if (type) { query += ' AND type = ?'; params.push(type); }
  if (account_id) { query += ' AND account_id = ?'; params.push(account_id); }
  if (category) { query += ' AND category LIKE ?'; params.push(`%${category}%`); }
  if (search) { query += ' AND description LIKE ?'; params.push(`%${search}%`); }
  if (from) { query += ' AND date >= ?'; params.push(from); }
  if (to) { query += ' AND date <= ?'; params.push(to); }

  const allowedSorts = ['created_at', 'updated_at', 'date', 'amount'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'created_at';
  const sortDir = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  query += ` ORDER BY ${sortCol} ${sortDir}`;

  const result = await paginate(query, params, page, limit, db);
  return sendSuccess(res, result.rows, 'Transactions fetched', 200, result.meta);
};

const createTransaction = async (req, res) => {
  const { account_id, type, amount, category, description, date } = req.body;
  if (!type || amount === undefined) return sendError(res, 'Type and amount are required', 400, 'BAD_REQUEST');

  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO transactions (user_id, account_id, type, amount, category, description, date, created_at, updated_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = await stmt.run(req.user.id, account_id || null, type, amount, category || null, description || null, date || now, now, now);
  
  if (account_id) {
    if (type === 'income') {
      db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ? AND user_id = ?')
        .run(amount, now, account_id, req.user.id);
    } else if (type === 'expense' || type === 'transfer') {
      db.prepare('UPDATE accounts SET balance = balance - ?, updated_at = ? WHERE id = ? AND user_id = ?')
        .run(amount, now, account_id, req.user.id);
    }
  }

  const newItem = await db.prepare('SELECT * FROM transactions WHERE id = ?').get(info.lastInsertRowid);
  await invalidateUserDashboard(req.user.id);
  return sendSuccess(res, newItem, 'Transaction created', 201);
};

const getTransaction = async (req, res) => {
  const item = await db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Transaction not found', 404, 'NOT_FOUND');
  return sendSuccess(res, item);
};

const updateTransaction = async (req, res) => {
  const item = await db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Transaction not found', 404, 'NOT_FOUND');

  const updates = [];
  const params = [];
  const allowedFields = ['account_id', 'type', 'amount', 'category', 'description', 'date'];
  
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
    await db.prepare(`UPDATE transactions SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
  }
  
  const updatedItem = await db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  await invalidateUserDashboard(req.user.id);
  return sendSuccess(res, updatedItem, 'Transaction updated');
};

const deleteTransaction = async (req, res) => {
  const item = await db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Transaction not found', 404, 'NOT_FOUND');

  await db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  await invalidateUserDashboard(req.user.id);
  return res.status(204).end();
};

module.exports = { getTransactions, createTransaction, getTransaction, updateTransaction, deleteTransaction };
