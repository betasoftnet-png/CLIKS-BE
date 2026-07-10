const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { paginate } = require('../utils/pagination');
const { invalidateUserDashboard } = require('../utils/cacheInvalidation');

const getTransactions = async (req, res) => {
  const { type, account_id, category, from, to, page, limit, sort = 'created_at', order = 'desc', search } = req.query;
  let query = 'SELECT * FROM transactions WHERE user_id = ?';
  const params = [req.user.id];

  if (type) { query += ' AND type = ?'; params.push(type.toLowerCase()); }
  if (account_id) { query += ' AND account_id = ?'; params.push(account_id); }
  if (category) { query += ' AND category LIKE ?'; params.push(`%${category}%`); }
  if (search) { query += ' AND (description LIKE ? OR category LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  if (from) { query += ' AND date >= ?'; params.push(from); }
  if (to) { query += ' AND date <= ?'; params.push(to); }

  const allowedSorts = ['created_at', 'updated_at', 'date', 'amount'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'created_at';
  const sortDir = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  query += ` ORDER BY ${sortCol} ${sortDir}`;

  const result = await paginate(query, params, page, limit, db);
  const formattedRows = result.rows.map(row => ({
    ...row,
    title: row.name || row.description || '',
  }));
  return sendSuccess(res, formattedRows, 'Transactions fetched', 200, result.meta);
};

const createTransaction = async (req, res) => {
  const { account_id, type, amount, category, description, title, date, name, time, schedule, notes } = req.body;
  if (!type || amount === undefined) return sendError(res, 'Type and amount are required', 400, 'BAD_REQUEST');

  const normalizedType = type.toLowerCase();
  const dbDescription = description || null;
  const dbName = name || title || null;
  const dbTime = time || null;
  const dbSchedule = schedule || notes || null;
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO transactions (user_id, account_id, type, amount, category, description, date, created_at, updated_at, name, time, schedule) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = await stmt.run(
    req.user.id,
    account_id || null,
    normalizedType,
    amount,
    category || null,
    dbDescription,
    date || now,
    now,
    now,
    dbName,
    dbTime,
    dbSchedule
  );
  
  if (account_id) {
    if (normalizedType === 'income') {
      await db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ? AND user_id = ?')
        .run(amount, now, account_id, req.user.id);
    } else if (normalizedType === 'expense' || normalizedType === 'transfer') {
      await db.prepare('UPDATE accounts SET balance = balance - ?, updated_at = ? WHERE id = ? AND user_id = ?')
        .run(amount, now, account_id, req.user.id);
    }
  }

  const newItem = await db.prepare('SELECT * FROM transactions WHERE id = ?').get(info.lastInsertRowid);
  const formattedNewItem = {
    ...newItem,
    title: newItem.name || newItem.description || '',
  };
  await invalidateUserDashboard(req.user.id);
  return sendSuccess(res, formattedNewItem, 'Transaction created', 201);
};

const getTransaction = async (req, res) => {
  const item = await db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Transaction not found', 404, 'NOT_FOUND');
  const formattedItem = {
    ...item,
    title: item.name || item.description || '',
  };
  return sendSuccess(res, formattedItem);
};

const updateTransaction = async (req, res) => {
  const item = await db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Transaction not found', 404, 'NOT_FOUND');

  const bodyUpdates = { ...req.body };
  if (bodyUpdates.type !== undefined) {
    bodyUpdates.type = bodyUpdates.type.toLowerCase();
  }
  if (bodyUpdates.name === undefined && bodyUpdates.title !== undefined) {
    bodyUpdates.name = bodyUpdates.title;
  }
  if (bodyUpdates.schedule === undefined && bodyUpdates.notes !== undefined) {
    bodyUpdates.schedule = bodyUpdates.notes;
  }

  const updates = [];
  const params = [];
  const allowedFields = ['account_id', 'type', 'amount', 'category', 'description', 'date', 'name', 'time', 'schedule'];
  
  for (const field of allowedFields) {
    if (bodyUpdates[field] !== undefined) {
      updates.push(`${field} = ?`);
      params.push(bodyUpdates[field]);
    }
  }

  if (updates.length > 0) {
    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(req.params.id, req.user.id);
    await db.prepare(`UPDATE transactions SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
  }
  
  const updatedItem = await db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  const formattedUpdatedItem = {
    ...updatedItem,
    title: updatedItem.name || updatedItem.description || '',
  };
  await invalidateUserDashboard(req.user.id);
  return sendSuccess(res, formattedUpdatedItem, 'Transaction updated');
};

const deleteTransaction = async (req, res) => {
  const item = await db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Transaction not found', 404, 'NOT_FOUND');

  await db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  await invalidateUserDashboard(req.user.id);
  return res.status(204).end();
};

module.exports = { getTransactions, createTransaction, getTransaction, updateTransaction, deleteTransaction };
