const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { paginate } = require('../utils/pagination');

const getPlannedPayments = async (req, res) => {
  const { status, category, page, limit, sort = 'created_at', order = 'desc', search } = req.query;
  let query = 'SELECT * FROM planned_payments WHERE user_id = ?';
  const params = [req.user.id];

  if (status) { query += ' AND status = ?'; params.push(status); }
  if (category) { query += ' AND category LIKE ?'; params.push(`%${category}%`); }
  if (search) { query += ' AND name LIKE ?'; params.push(`%${search}%`); }

  const allowedSorts = ['created_at', 'updated_at', 'amount', 'due_date'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'created_at';
  const sortDir = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  query += ` ORDER BY ${sortCol} ${sortDir}`;

  const result = await paginate(query, params, page, limit, db);
  return sendSuccess(res, result.rows, 'Planned payments fetched', 200, result.meta);
};

const createPlannedPayment = async (req, res) => {
  const { account_id, name, amount, due_date, frequency, category, status = 'pending' } = req.body;
  if (!name || amount === undefined || !due_date) return sendError(res, 'Name, amount, and due_date are required', 400, 'BAD_REQUEST');

  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO planned_payments (user_id, account_id, name, amount, due_date, frequency, category, status, created_at, updated_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = await stmt.run(req.user.id, account_id || null, name, amount, due_date, frequency || null, category || null, status, now, now);
  
  const newItem = await db.prepare('SELECT * FROM planned_payments WHERE id = ?').get(info.lastInsertRowid);
  return sendSuccess(res, newItem, 'Planned payment created', 201);
};

const getPlannedPayment = async (req, res) => {
  const item = await db.prepare('SELECT * FROM planned_payments WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Planned payment not found', 404, 'NOT_FOUND');
  return sendSuccess(res, item);
};

const updatePlannedPayment = async (req, res) => {
  const item = await db.prepare('SELECT * FROM planned_payments WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Planned payment not found', 404, 'NOT_FOUND');

  const updates = [];
  const params = [];
  const allowedFields = ['account_id', 'name', 'amount', 'due_date', 'frequency', 'category', 'status'];
  
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
    await db.prepare(`UPDATE planned_payments SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
  }
  
  const updatedItem = await db.prepare('SELECT * FROM planned_payments WHERE id = ?').get(req.params.id);
  return sendSuccess(res, updatedItem, 'Planned payment updated');
};

const markPlannedPaymentPaid = async (req, res) => {
  const item = await db.prepare('SELECT * FROM planned_payments WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Planned payment not found', 404, 'NOT_FOUND');

  const now = new Date().toISOString();
  db.prepare(`UPDATE planned_payments SET status = 'paid', updated_at = ? WHERE id = ? AND user_id = ?`)
    .run(now, req.params.id, req.user.id);

  const updatedItem = await db.prepare('SELECT * FROM planned_payments WHERE id = ?').get(req.params.id);
  return sendSuccess(res, updatedItem, 'Planned payment marked as paid');
};

const deletePlannedPayment = async (req, res) => {
  const item = await db.prepare('SELECT * FROM planned_payments WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Planned payment not found', 404, 'NOT_FOUND');

  await db.prepare('DELETE FROM planned_payments WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  return res.status(204).end();
};

module.exports = { getPlannedPayments, createPlannedPayment, getPlannedPayment, updatePlannedPayment, markPlannedPaymentPaid, deletePlannedPayment };
