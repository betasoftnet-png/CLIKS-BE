const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { paginate } = require('../utils/pagination');

// Middleware: Verify person ownership
const verifyPerson = async (req, res, next) => {
  const person = await db.prepare('SELECT * FROM people WHERE id = ? AND user_id = ?').get(req.params.personId, req.user.id);
  if (!person) return sendError(res, 'Person not found', 404, 'NOT_FOUND');
  next();
};

const getRecords = async (req, res) => {
  const { page, limit, sort = 'created_at', order = 'desc', search, type } = req.query;
  let query = 'SELECT * FROM people_records WHERE person_id = ? AND user_id = ?';
  const params = [req.params.personId, req.user.id];

  if (type) { query += ' AND type = ?'; params.push(type); }
  if (search) { query += ' AND (title LIKE ? OR description LIKE ? OR content LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }

  const allowedSorts = ['created_at', 'updated_at', 'title', 'type'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'created_at';
  const sortDir = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  query += ` ORDER BY ${sortCol} ${sortDir}`;

  const result = await paginate(query, params, page, limit, db);
  return sendSuccess(res, result.rows, 'People records fetched', 200, result.meta);
};

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const createRecord = async (req, res) => {
  const { title, type, description, content, file_data, file_name } = req.body;
  if (!title || !type) return sendError(res, 'Title and type are required', 400, 'BAD_REQUEST');

  let attachment_url = null;
  let file_type = null;

  // Handle Base64 file upload if provided
  if (file_data && file_name) {
    try {
      const base64Data = file_data.replace(/^data:.*?;base64,/, '');
      const ext = path.extname(file_name) || '.bin';
      const fileName = `${randomUUID()}${ext}`;
      const uploadPath = path.join(__dirname, '../uploads', fileName);
      
      fs.writeFileSync(uploadPath, base64Data, 'base64');
      attachment_url = `/uploads/${fileName}`;
      file_type = ext.replace('.', '').toUpperCase();
    } catch (err) {
      console.error('File upload error:', err);
    }
  }

  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO people_records (person_id, user_id, title, type, description, content, attachment_url, file_type, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = await stmt.run(req.params.personId, req.user.id, title, type, description || null, content || null, attachment_url, file_type, now, now);

  const newItem = await db.prepare('SELECT * FROM people_records WHERE id = ?').get(info.lastInsertRowid);
  return sendSuccess(res, newItem, 'Person record created', 201);
};

const getRecord = async (req, res) => {
  const item = await db.prepare('SELECT * FROM people_records WHERE id = ? AND person_id = ? AND user_id = ?').get(req.params.id, req.params.personId, req.user.id);
  if (!item) return sendError(res, 'Person record not found', 404, 'NOT_FOUND');
  return sendSuccess(res, item);
};

const updateRecord = async (req, res) => {
  const item = await db.prepare('SELECT * FROM people_records WHERE id = ? AND person_id = ? AND user_id = ?').get(req.params.id, req.params.personId, req.user.id);
  if (!item) return sendError(res, 'Person record not found', 404, 'NOT_FOUND');

  const updates = [];
  const params = [];
  for (const field of ['title', 'type', 'description', 'content', 'attachment_url', 'file_type']) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      params.push(req.body[field]);
    }
  }

  if (updates.length > 0) {
    updates.push('updated_at = ?');
    params.push(new Date().toISOString(), req.params.id, req.params.personId, req.user.id);
    await db.prepare(`UPDATE people_records SET ${updates.join(', ')} WHERE id = ? AND person_id = ? AND user_id = ?`).run(...params);
  }

  const updatedItem = await db.prepare('SELECT * FROM people_records WHERE id = ?').get(req.params.id);
  return sendSuccess(res, updatedItem, 'Person record updated');
};

const deleteRecord = async (req, res) => {
  const item = await db.prepare('SELECT * FROM people_records WHERE id = ? AND person_id = ? AND user_id = ?').get(req.params.id, req.params.personId, req.user.id);
  if (!item) return sendError(res, 'Person record not found', 404, 'NOT_FOUND');

  await db.prepare('DELETE FROM people_records WHERE id = ? AND person_id = ? AND user_id = ?').run(req.params.id, req.params.personId, req.user.id);
  return res.status(204).end();
};

module.exports = { verifyPerson, getRecords, createRecord, getRecord, updateRecord, deleteRecord };
