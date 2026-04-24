const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { paginate } = require('../utils/pagination');

// Middleware: Verify person ownership
const verifyPerson = async (req, res, next) => {
  const person = await db.prepare('SELECT * FROM people WHERE id = ? AND user_id = ?').get(req.params.personId, req.user.id);
  if (!person) return sendError(res, 'Person not found', 404, 'NOT_FOUND');
  next();
};

const getTransactions = async (req, res) => {
  const { page, limit, sort = 'date', order = 'desc', search, type } = req.query;
  let query = 'SELECT * FROM people_transactions WHERE person_id = ? AND user_id = ?';
  const params = [req.params.personId, req.user.id];

  if (type) { query += ' AND type = ?'; params.push(type); }
  if (search) { query += ' AND (description LIKE ? OR category LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

  const allowedSorts = ['created_at', 'updated_at', 'date', 'amount', 'type'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'date';
  const sortDir = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  query += ` ORDER BY ${sortCol} ${sortDir}`;

  const result = await paginate(query, params, page, limit, db);
  return sendSuccess(res, result.rows, 'People transactions fetched', 200, result.meta);
};

const createTransaction = async (req, res) => {
  const { type, amount, date, description, category } = req.body;
  if (!type || amount === undefined || !date) return sendError(res, 'Type, amount, and date are required', 400, 'BAD_REQUEST');

  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO people_transactions (person_id, user_id, type, amount, date, description, category, created_at, updated_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = await stmt.run(req.params.personId, req.user.id, type, amount, date, description || null, category || null, now, now);
  
  const newItem = await db.prepare('SELECT * FROM people_transactions WHERE id = ?').get(info.lastInsertRowid);
  return sendSuccess(res, newItem, 'Person transaction created', 201);
};

const getTransaction = async (req, res) => {
  const item = await db.prepare('SELECT * FROM people_transactions WHERE id = ? AND person_id = ? AND user_id = ?').get(req.params.id, req.params.personId, req.user.id);
  if (!item) return sendError(res, 'Person transaction not found', 404, 'NOT_FOUND');
  return sendSuccess(res, item);
};

const updateTransaction = async (req, res) => {
  const item = await db.prepare('SELECT * FROM people_transactions WHERE id = ? AND person_id = ? AND user_id = ?').get(req.params.id, req.params.personId, req.user.id);
  if (!item) return sendError(res, 'Person transaction not found', 404, 'NOT_FOUND');

  const updates = [];
  const params = [];
  const allowedFields = ['type', 'amount', 'date', 'description', 'category'];
  
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      params.push(req.body[field]);
    }
  }

  if (updates.length > 0) {
    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(req.params.id, req.params.personId, req.user.id);
    await db.prepare(`UPDATE people_transactions SET ${updates.join(', ')} WHERE id = ? AND person_id = ? AND user_id = ?`).run(...params);
  }
  
  const updatedItem = await db.prepare('SELECT * FROM people_transactions WHERE id = ?').get(req.params.id);
  return sendSuccess(res, updatedItem, 'Person transaction updated');
};

const deleteTransaction = async (req, res) => {
  const item = await db.prepare('SELECT * FROM people_transactions WHERE id = ? AND person_id = ? AND user_id = ?').get(req.params.id, req.params.personId, req.user.id);
  if (!item) return sendError(res, 'Person transaction not found', 404, 'NOT_FOUND');

  await db.prepare('DELETE FROM people_transactions WHERE id = ? AND person_id = ? AND user_id = ?').run(req.params.id, req.params.personId, req.user.id);
  return res.status(204).end();
};

module.exports = { verifyPerson, getTransactions, createTransaction, getTransaction, updateTransaction, deleteTransaction };
