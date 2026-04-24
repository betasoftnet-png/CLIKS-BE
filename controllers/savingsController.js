const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { paginate } = require('../utils/pagination');

const getSavings = async (req, res) => {
  const { page, limit, sort = 'created_at', order = 'desc', search } = req.query;
  let query = 'SELECT * FROM savings WHERE user_id = ?';
  const params = [req.user.id];

  if (search) {
    query += ' AND name LIKE ?';
    params.push(`%${search}%`);
  }

  const allowedSorts = ['created_at', 'updated_at', 'target_amount', 'current_amount', 'deadline'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'created_at';
  const sortDir = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  query += ` ORDER BY ${sortCol} ${sortDir}`;

  const result = await paginate(query, params, page, limit, db);
  return sendSuccess(res, result.rows, 'Savings fetched', 200, result.meta);
};

const createSavings = async (req, res) => {
  const { name, target_amount, current_amount = 0, deadline, notes } = req.body;
  if (!name || target_amount === undefined) return sendError(res, 'Name and target_amount are required', 400, 'BAD_REQUEST');

  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO savings (user_id, name, target_amount, current_amount, deadline, notes, created_at, updated_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = await stmt.run(req.user.id, name, target_amount, current_amount, deadline || null, notes || null, now, now);
  
  const newItem = await db.prepare('SELECT * FROM savings WHERE id = ?').get(info.lastInsertRowid);
  return sendSuccess(res, newItem, 'Savings goal created', 201);
};

const getSaving = async (req, res) => {
  const item = await db.prepare('SELECT * FROM savings WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Savings goal not found', 404, 'NOT_FOUND');
  return sendSuccess(res, item);
};

const updateSaving = async (req, res) => {
  const item = await db.prepare('SELECT * FROM savings WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Savings goal not found', 404, 'NOT_FOUND');

  const updates = [];
  const params = [];
  const allowedFields = ['name', 'target_amount', 'current_amount', 'deadline', 'notes'];
  
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
    await db.prepare(`UPDATE savings SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
  }
  
  const updatedItem = await db.prepare('SELECT * FROM savings WHERE id = ?').get(req.params.id);
  return sendSuccess(res, updatedItem, 'Savings goal updated');
};

const depositSaving = async (req, res) => {
  const { amount } = req.body;
  if (amount === undefined || amount <= 0) return sendError(res, 'Valid amount is required', 400, 'BAD_REQUEST');

  const item = await db.prepare('SELECT * FROM savings WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Savings goal not found', 404, 'NOT_FOUND');

  let newAmount = item.current_amount + amount;
  if (item.target_amount !== null && newAmount > item.target_amount) {
    newAmount = item.target_amount;
  }

  const now = new Date().toISOString();
  db.prepare(`UPDATE savings SET current_amount = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
    .run(newAmount, now, req.params.id, req.user.id);

  const updatedItem = await db.prepare('SELECT * FROM savings WHERE id = ?').get(req.params.id);
  return sendSuccess(res, updatedItem, 'Deposit successful');
};

const deleteSaving = async (req, res) => {
  const item = await db.prepare('SELECT * FROM savings WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Savings goal not found', 404, 'NOT_FOUND');

  await db.prepare('DELETE FROM savings WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  return res.status(204).end();
};

module.exports = { getSavings, createSavings, getSaving, updateSaving, depositSaving, deleteSaving };
