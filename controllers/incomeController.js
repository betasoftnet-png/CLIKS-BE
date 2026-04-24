const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { paginate } = require('../utils/pagination');

const getIncomes = async (req, res) => {
  const { source, frequency, from, to, page, limit, sort = 'created_at', order = 'desc', search } = req.query;
  let query = 'SELECT * FROM income WHERE user_id = ?';
  const params = [req.user.id];

  if (source) { query += ' AND source LIKE ?'; params.push(`%${source}%`); }
  if (frequency) { query += ' AND frequency = ?'; params.push(frequency); }
  if (search) { query += ' AND (source LIKE ? OR notes LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  if (from) { query += ' AND date >= ?'; params.push(from); }
  if (to) { query += ' AND date <= ?'; params.push(to); }

  const allowedSorts = ['created_at', 'updated_at', 'date', 'amount'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'created_at';
  const sortDir = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  query += ` ORDER BY ${sortCol} ${sortDir}`;

  const result = await paginate(query, params, page, limit, db);
  return sendSuccess(res, result.rows, 'Income records fetched', 200, result.meta);
};

const createIncome = async (req, res) => {
  const { account_id, source, amount, frequency = 'one-time', category, date, notes } = req.body;
  if (amount === undefined) return sendError(res, 'Amount is required', 400, 'BAD_REQUEST');

  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO income (user_id, account_id, source, amount, frequency, category, date, notes, created_at, updated_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = await stmt.run(req.user.id, account_id || null, source || null, amount, frequency, category || null, date || now, notes || null, now, now);
  
  if (account_id) {
    db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .run(amount, now, account_id, req.user.id);
  }
  
  const newItem = await db.prepare('SELECT * FROM income WHERE id = ?').get(info.lastInsertRowid);
  return sendSuccess(res, newItem, 'Income created', 201);
};

const getIncome = async (req, res) => {
  const item = await db.prepare('SELECT * FROM income WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Income not found', 404, 'NOT_FOUND');
  return sendSuccess(res, item);
};

const updateIncome = async (req, res) => {
  const item = await db.prepare('SELECT * FROM income WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Income not found', 404, 'NOT_FOUND');

  const updates = [];
  const params = [];
  const allowedFields = ['account_id', 'source', 'amount', 'frequency', 'category', 'date', 'notes'];
  
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
    await db.prepare(`UPDATE income SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
  }
  
  const updatedItem = await db.prepare('SELECT * FROM income WHERE id = ?').get(req.params.id);
  return sendSuccess(res, updatedItem, 'Income updated');
};

const deleteIncome = async (req, res) => {
  const item = await db.prepare('SELECT * FROM income WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Income not found', 404, 'NOT_FOUND');

  await db.prepare('DELETE FROM income WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  return res.status(204).end();
};

module.exports = { getIncomes, createIncome, getIncome, updateIncome, deleteIncome };
