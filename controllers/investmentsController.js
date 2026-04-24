const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { paginate } = require('../utils/pagination');

const getInvestments = async (req, res) => {
  const { type, page, limit, sort = 'created_at', order = 'desc', search } = req.query;
  let query = 'SELECT * FROM investments WHERE user_id = ?';
  const params = [req.user.id];

  if (type) { query += ' AND type = ?'; params.push(type); }
  if (search) { query += ' AND name LIKE ?'; params.push(`%${search}%`); }

  const allowedSorts = ['created_at', 'updated_at', 'name', 'amount_invested', 'current_value', 'purchase_date'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'created_at';
  const sortDir = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  query += ` ORDER BY ${sortCol} ${sortDir}`;

  const result = await paginate(query, params, page, limit, db);
  return sendSuccess(res, result.rows, 'Investments fetched', 200, result.meta);
};

const createInvestment = async (req, res) => {
  const { name, type, amount_invested, current_value, purchase_date, notes } = req.body;
  if (!name || amount_invested === undefined) return sendError(res, 'Name and amount_invested are required', 400, 'BAD_REQUEST');

  const now = new Date().toISOString();
  const initialValue = current_value !== undefined ? current_value : amount_invested;

  const stmt = db.prepare(`
    INSERT INTO investments (user_id, name, type, amount_invested, current_value, purchase_date, notes, created_at, updated_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = await stmt.run(req.user.id, name, type || null, amount_invested, initialValue, purchase_date || now, notes || null, now, now);
  
  const newItem = await db.prepare('SELECT * FROM investments WHERE id = ?').get(info.lastInsertRowid);
  return sendSuccess(res, newItem, 'Investment created', 201);
};

const getInvestment = async (req, res) => {
  const item = await db.prepare('SELECT * FROM investments WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Investment not found', 404, 'NOT_FOUND');
  return sendSuccess(res, item);
};

const updateInvestment = async (req, res) => {
  const item = await db.prepare('SELECT * FROM investments WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Investment not found', 404, 'NOT_FOUND');

  const updates = [];
  const params = [];
  const allowedFields = ['name', 'type', 'amount_invested', 'current_value', 'purchase_date', 'notes'];
  
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
    await db.prepare(`UPDATE investments SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
  }
  
  const updatedItem = await db.prepare('SELECT * FROM investments WHERE id = ?').get(req.params.id);
  return sendSuccess(res, updatedItem, 'Investment updated');
};

const deleteInvestment = async (req, res) => {
  const item = await db.prepare('SELECT * FROM investments WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Investment not found', 404, 'NOT_FOUND');

  await db.prepare('DELETE FROM investments WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  return res.status(204).end();
};

module.exports = { getInvestments, createInvestment, getInvestment, updateInvestment, deleteInvestment };
