const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { paginate } = require('../utils/pagination');

// Global People Transactions
const getAllTransactions = async (req, res) => {
  const { page, limit, sort = 'date', order = 'desc', search, type } = req.query;
  let query = `
    SELECT pt.*, p.name as person_name 
    FROM people_transactions pt 
    JOIN people p ON pt.person_id = p.id 
    WHERE pt.user_id = ?
  `;
  const params = [req.user.id];

  if (type) { query += ' AND pt.type = ?'; params.push(type); }
  if (search) { 
    query += ' AND (pt.description LIKE ? OR pt.category LIKE ? OR p.name LIKE ?)'; 
    params.push(`%${search}%`, `%${search}%`, `%${search}%`); 
  }

  const allowedSorts = ['created_at', 'updated_at', 'date', 'amount', 'type'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'date';
  const sortDir = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  query += ` ORDER BY pt.${sortCol} ${sortDir}`;

  const result = await paginate(query, params, page, limit, db);
  return sendSuccess(res, result.rows, 'All people transactions fetched', 200, result.meta);
};

// Global People Reminders
const getAllReminders = async (req, res) => {
  const { page, limit, sort = 'due_date', order = 'asc', search, status } = req.query;
  let query = `
    SELECT pr.*, p.name as person_name 
    FROM people_reminders pr 
    JOIN people p ON pr.person_id = p.id 
    WHERE pr.user_id = ?
  `;
  const params = [req.user.id];

  if (status) { query += ' AND pr.status = ?'; params.push(status); }
  if (search) { 
    query += ' AND (pr.title LIKE ? OR pr.message LIKE ? OR p.name LIKE ?)'; 
    params.push(`%${search}%`, `%${search}%`, `%${search}%`); 
  }

  const allowedSorts = ['created_at', 'updated_at', 'due_date', 'status'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'due_date';
  const sortDir = order.toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  query += ` ORDER BY pr.${sortCol} ${sortDir}`;

  const result = await paginate(query, params, page, limit, db);

  const stats = db.prepare(`
    SELECT 
      SUM(CASE WHEN date(due_date) = date('now') AND status != 'settled' THEN 1 ELSE 0 END) as due_today,
      SUM(CASE WHEN date(due_date) > date('now') AND status != 'settled' THEN 1 ELSE 0 END) as upcoming,
      SUM(CASE WHEN date(due_date) < date('now') AND status != 'settled' THEN 1 ELSE 0 END) as overdue
    FROM people_reminders
    WHERE user_id = ?
  `).get(req.user.id);

  return sendSuccess(res, result.rows, 'All people reminders fetched', 200, { ...result.meta, stats });
};

// Global People Records
const getAllRecords = async (req, res) => {
  const { page, limit, sort = 'created_at', order = 'desc', search } = req.query;
  let query = `
    SELECT pr.*, p.name as person_name 
    FROM people_records pr 
    JOIN people p ON pr.person_id = p.id 
    WHERE pr.user_id = ?
  `;
  const params = [req.user.id];

  if (search) { 
    query += ' AND (pr.title LIKE ? OR pr.notes LIKE ? OR p.name LIKE ?)'; 
    params.push(`%${search}%`, `%${search}%`, `%${search}%`); 
  }

  const allowedSorts = ['created_at', 'updated_at', 'title'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'created_at';
  const sortDir = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  query += ` ORDER BY pr.${sortCol} ${sortDir}`;

  const result = await paginate(query, params, page, limit, db);

  const stats = db.prepare(`
    SELECT 
      COUNT(*) as total_records
    FROM people_records
    WHERE user_id = ?
  `).get(req.user.id);

  return sendSuccess(res, result.rows, 'All people records fetched', 200, { ...result.meta, stats });
};

const getPeople = async (req, res) => {
  const { page, limit, sort = 'name', order = 'asc', search, role_type } = req.query;
  
  let query = `
    SELECT p.*,
      COALESCE(SUM(CASE WHEN pt.type = 'lent' THEN pt.amount ELSE 0 END), 0) as total_lent,
      COALESCE(SUM(CASE WHEN pt.type = 'borrowed' THEN pt.amount ELSE 0 END), 0) as total_borrowed,
      COALESCE(SUM(CASE WHEN pt.type = 'lent' THEN pt.amount WHEN pt.type = 'borrowed' THEN -pt.amount ELSE 0 END), 0) as net_balance
    FROM people p
    LEFT JOIN people_transactions pt ON p.id = pt.person_id
    WHERE p.user_id = ?
  `;
  const params = [req.user.id];

  if (role_type) { query += ' AND p.role_type = ?'; params.push(role_type); }
  if (search) { 
    query += ' AND (p.name LIKE ? OR p.company LIKE ? OR p.contact_info LIKE ?)'; 
    params.push(`%${search}%`, `%${search}%`, `%${search}%`); 
  }

  query += ' GROUP BY p.id';

  const allowedSorts = ['created_at', 'updated_at', 'name', 'company', 'net_balance'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'name';
  const sortDir = order.toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  query += ` ORDER BY ${sortCol} ${sortDir}`;

  const result = await paginate(query, params, page, limit, db);

  const summary = db.prepare(`
    SELECT 
      COUNT(*) as total_contacts,
      SUM(CASE WHEN net_balance > 0 THEN net_balance ELSE 0 END) as total_receivables,
      SUM(CASE WHEN net_balance < 0 THEN ABS(net_balance) ELSE 0 END) as total_payables
    FROM (
      SELECT p.id,
        COALESCE(SUM(CASE WHEN pt.type = 'lent' THEN pt.amount WHEN pt.type = 'borrowed' THEN -pt.amount ELSE 0 END), 0) as net_balance
      FROM people p
      LEFT JOIN people_transactions pt ON p.id = pt.person_id
      WHERE p.user_id = ?
      GROUP BY p.id
    )
  `).get(req.user.id);

  return sendSuccess(res, result.rows, 'People fetched', 200, { ...result.meta, summary });
};

const createPerson = async (req, res) => {
  const { name, role_type, relationship, phone, email, company, contact_info, notes } = req.body;
  if (!name || !role_type) return sendError(res, 'Name and role_type are required', 400, 'BAD_REQUEST');

  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO people (user_id, name, role_type, relationship, phone, email, company, contact_info, notes, created_at, updated_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = await stmt.run(req.user.id, name, role_type, relationship || null, phone || null, email || null, company || null, contact_info || null, notes || null, now, now);
  
  const newItem = await db.prepare('SELECT * FROM people WHERE id = ?').get(info.lastInsertRowid);
  return sendSuccess(res, newItem, 'Person created', 201);
};

const getPerson = async (req, res) => {
  const person = await db.prepare('SELECT * FROM people WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!person) return sendError(res, 'Person not found', 404, 'NOT_FOUND');
  return sendSuccess(res, person);
};

const updatePerson = async (req, res) => {
  const person = await db.prepare('SELECT * FROM people WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!person) return sendError(res, 'Person not found', 404, 'NOT_FOUND');

  const updates = [];
  const params = [];
  const allowedFields = ['name', 'role_type', 'relationship', 'phone', 'email', 'company', 'contact_info', 'notes'];
  
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
    await db.prepare(`UPDATE people SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
  }
  
  const updatedItem = await db.prepare('SELECT * FROM people WHERE id = ?').get(req.params.id);
  return sendSuccess(res, updatedItem, 'Person updated');
};

const deletePerson = async (req, res) => {
  const person = await db.prepare('SELECT * FROM people WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!person) return sendError(res, 'Person not found', 404, 'NOT_FOUND');

  const deletePersonTx = db.transaction(async () => {
    const pId = req.params.id;
    const uId = req.user.id;
    await db.prepare('DELETE FROM people_transactions WHERE person_id = ? AND user_id = ?').run(pId, uId);
    await db.prepare('DELETE FROM people_reminders WHERE person_id = ? AND user_id = ?').run(pId, uId);
    await db.prepare('DELETE FROM people_records WHERE person_id = ? AND user_id = ?').run(pId, uId);
    await db.prepare('DELETE FROM people WHERE id = ? AND user_id = ?').run(pId, uId);
  });

  await deletePersonTx();
  return res.status(204).end();
};

module.exports = { getAllTransactions, getAllReminders, getAllRecords, getPeople, createPerson, getPerson, updatePerson, deletePerson };
