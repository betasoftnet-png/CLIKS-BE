const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { paginate } = require('../utils/pagination');

const getDebts = async (req, res) => {
  const { creditor, page, limit, sort = 'created_at', order = 'desc', search } = req.query;
  let query = 'SELECT * FROM debts WHERE user_id = ?';
  const params = [req.user.id];

  if (creditor) { query += ' AND creditor LIKE ?'; params.push(`%${creditor}%`); }
  if (search) { query += ' AND creditor LIKE ?'; params.push(`%${search}%`); }

  const allowedSorts = ['created_at', 'updated_at', 'amount', 'amount_paid', 'due_date'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'created_at';
  const sortDir = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  query += ` ORDER BY ${sortCol} ${sortDir}`;

  const result = await paginate(query, params, page, limit, db);
  return sendSuccess(res, result.rows, 'Debts fetched', 200, result.meta);
};

const createDebt = async (req, res) => {
  const { creditor, amount, amount_paid = 0, due_date, interest_rate, notes } = req.body;
  if (!creditor || amount === undefined) return sendError(res, 'Creditor and amount are required', 400, 'BAD_REQUEST');

  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO debts (user_id, creditor, amount, amount_paid, due_date, interest_rate, notes, created_at, updated_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = await stmt.run(req.user.id, creditor, amount, amount_paid, due_date || null, interest_rate || null, notes || null, now, now);
  
  const newItem = await db.prepare('SELECT * FROM debts WHERE id = ?').get(info.lastInsertRowid);
  return sendSuccess(res, newItem, 'Debt created', 201);
};

const getDebt = async (req, res) => {
  const item = await db.prepare('SELECT * FROM debts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Debt not found', 404, 'NOT_FOUND');
  return sendSuccess(res, item);
};

const updateDebt = async (req, res) => {
  const item = await db.prepare('SELECT * FROM debts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Debt not found', 404, 'NOT_FOUND');

  const updates = [];
  const params = [];
  const allowedFields = ['creditor', 'amount', 'amount_paid', 'due_date', 'interest_rate', 'notes'];
  
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
    await db.prepare(`UPDATE debts SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
  }
  
  const updatedItem = await db.prepare('SELECT * FROM debts WHERE id = ?').get(req.params.id);
  return sendSuccess(res, updatedItem, 'Debt updated');
};

const payDebt = async (req, res) => {
  const { amount } = req.body;
  if (amount === undefined || amount <= 0) return sendError(res, 'Valid amount is required', 400, 'BAD_REQUEST');

  const item = await db.prepare('SELECT * FROM debts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Debt not found', 404, 'NOT_FOUND');

  let newAmountPaid = item.amount_paid + amount;
  if (newAmountPaid > item.amount) {
    newAmountPaid = item.amount;
  }

  const now = new Date().toISOString();
  db.prepare(`UPDATE debts SET amount_paid = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
    .run(newAmountPaid, now, req.params.id, req.user.id);

  const updatedItem = await db.prepare('SELECT * FROM debts WHERE id = ?').get(req.params.id);
  return sendSuccess(res, updatedItem, 'Payment recorded');
};

const deleteDebt = async (req, res) => {
  const item = await db.prepare('SELECT * FROM debts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Debt not found', 404, 'NOT_FOUND');

  await db.prepare('DELETE FROM debts WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  return res.status(204).end();
};

module.exports = { getDebts, createDebt, getDebt, updateDebt, payDebt, deleteDebt };
