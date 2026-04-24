const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { paginate } = require('../utils/pagination');

const getAccounts = async (req, res) => {
  const { search, page, limit, sort = 'created_at', order = 'desc' } = req.query;
  let query = 'SELECT * FROM accounts WHERE user_id = ?';
  const params = [req.user.id];

  if (search) {
    query += ' AND name LIKE ?';
    params.push(`%${search}%`);
  }

  const allowedSorts = ['created_at', 'updated_at', 'name', 'balance'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'created_at';
  const sortDir = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  query += ` ORDER BY ${sortCol} ${sortDir}`;

  const result = await paginate(query, params, page, limit, db);
  return sendSuccess(res, result.rows, 'Accounts fetched', 200, result.meta);
};

const createAccount = async (req, res) => {
  const { name, type, balance = 0, currency = 'INR', color, icon } = req.body;
  if (!name) return sendError(res, 'Name is required', 400, 'BAD_REQUEST');

  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO accounts (user_id, name, type, balance, currency, color, icon, created_at, updated_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = await stmt.run(req.user.id, name, type || null, balance, currency, color || null, icon || null, now, now);
  
  const newItem = await db.prepare('SELECT * FROM accounts WHERE id = ?').get(info.lastInsertRowid);
  return sendSuccess(res, newItem, 'Account created', 201);
};

const getAccount = async (req, res) => {
  const item = await db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Account not found', 404, 'NOT_FOUND');
  return sendSuccess(res, item);
};

const updateAccount = async (req, res) => {
  const item = await db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Account not found', 404, 'NOT_FOUND');

  const updates = [];
  const params = [];
  const allowedFields = ['name', 'type', 'balance', 'currency', 'color', 'icon'];
  
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
    await db.prepare(`UPDATE accounts SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
  }
  
  const updatedItem = await db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  return sendSuccess(res, updatedItem, 'Account updated');
};

const deleteAccount = async (req, res) => {
  const item = await db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Account not found', 404, 'NOT_FOUND');

  await db.prepare('DELETE FROM accounts WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  return res.status(204).end();
};

module.exports = { getAccounts, createAccount, getAccount, updateAccount, deleteAccount };
