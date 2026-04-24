const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { paginate } = require('../utils/pagination');

const getContacts = async (req, res) => {
  const { page, limit, sort = 'created_at', order = 'desc', search, type } = req.query;
  let query = 'SELECT * FROM contacts WHERE user_id = ?';
  const params = [req.user.id];

  if (type) { query += ' AND type = ?'; params.push(type); }
  if (search) { query += ' AND (name LIKE ? OR email LIKE ? OR phone LIKE ? OR company LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`); }

  const allowedSorts = ['created_at', 'updated_at', 'name', 'email', 'company'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'created_at';
  const sortDir = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  query += ` ORDER BY ${sortCol} ${sortDir}`;

  const result = await paginate(query, params, page, limit, db);
  return sendSuccess(res, result.rows, 'Contacts fetched', 200, result.meta);
};

const createContact = async (req, res) => {
  const { name, email, phone, company, type, address, notes } = req.body;
  if (!name) return sendError(res, 'Name is required', 400, 'BAD_REQUEST');

  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO contacts (user_id, name, email, phone, company, type, address, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = await stmt.run(req.user.id, name, email || null, phone || null, company || null, type || null, address || null, notes || null, now, now);

  const newItem = await db.prepare('SELECT * FROM contacts WHERE id = ?').get(info.lastInsertRowid);
  return sendSuccess(res, newItem, 'Contact created', 201);
};

const getContact = async (req, res) => {
  const contact = await db.prepare('SELECT * FROM contacts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!contact) return sendError(res, 'Contact not found', 404, 'NOT_FOUND');
  return sendSuccess(res, contact);
};

const updateContact = async (req, res) => {
  const contact = await db.prepare('SELECT * FROM contacts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!contact) return sendError(res, 'Contact not found', 404, 'NOT_FOUND');

  const updates = [];
  const params = [];
  const allowedFields = ['name', 'email', 'phone', 'company', 'type', 'address', 'notes'];

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      params.push(req.body[field]);
    }
  }

  if (updates.length > 0) {
    updates.push('updated_at = ?');
    params.push(new Date().toISOString(), req.params.id, req.user.id);
    await db.prepare(`UPDATE contacts SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
  }

  const updatedItem = await db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
  return sendSuccess(res, updatedItem, 'Contact updated');
};

const deleteContact = async (req, res) => {
  const contact = await db.prepare('SELECT * FROM contacts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!contact) return sendError(res, 'Contact not found', 404, 'NOT_FOUND');

  await db.prepare('DELETE FROM contacts WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  return res.status(204).end();
};

module.exports = { getContacts, createContact, getContact, updateContact, deleteContact };
