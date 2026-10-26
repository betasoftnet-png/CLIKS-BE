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

  query += ` ORDER BY pt.${sortCol} ${sortDir}, pt.created_at DESC, pt.id DESC`;

  const result = await paginate(query, params, page, limit, db);
  return sendSuccess(res, result.rows, 'All people transactions fetched', 200, result.meta);
};

const RepaymentAlert = require('../models/RepaymentAlert');

// Global People Reminders / Repayment Alerts
const getAllReminders = async (req, res) => {
  const { search, status } = req.query;
  await RepaymentAlert.ensureTable();

  // 1. Primary query: repayment_alerts table
  const alerts = await RepaymentAlert.getAll(req.user.id);

  // 2. Also retrieve any legacy people_reminders (using LEFT JOIN so contacts without strict foreign matches are not lost)
  let legacyAlerts = [];
  try {
    const legacyRows = await db.prepare(`
      SELECT pr.*, p.name as person_name, p.phone as contact_phone 
      FROM people_reminders pr 
      LEFT JOIN people p ON pr.person_id = p.id 
      WHERE pr.user_id = ?
    `).all(req.user.id);

    legacyAlerts = (legacyRows || []).map(r => ({
      id: r.id,
      user_id: r.user_id,
      contact_id: r.person_id,
      person_id: r.person_id,
      target_contact: r.person_name || 'Contact',
      person_name: r.person_name || 'Contact',
      contact_phone: r.contact_phone || null,
      maturity_date: r.due_date,
      due_date: r.due_date,
      memo_label: r.title || 'Repayment Alert',
      title: r.title || 'Repayment Alert',
      claim_cap: Number(r.amount) || 0,
      amount: Number(r.amount) || 0,
      status: r.status || 'Pending',
      created_at: r.created_at
    }));
  } catch (e) {}

  // Merge avoiding duplicates
  const combined = [...alerts];
  for (const leg of legacyAlerts) {
    const exists = combined.some(a => 
      (a.id === leg.id && a.target_contact === leg.target_contact) ||
      (String(a.contact_id) === String(leg.contact_id) && String(a.maturity_date || a.due_date).slice(0, 10) === String(leg.maturity_date || leg.due_date).slice(0, 10) && (a.memo_label || a.title) === (leg.memo_label || leg.title)) ||
      (
        (a.target_contact || '').toLowerCase().trim() === (leg.target_contact || '').toLowerCase().trim() &&
        (a.memo_label || a.title || '').toLowerCase().trim() === (leg.memo_label || leg.title || '').toLowerCase().trim() &&
        Math.abs(Number(a.claim_cap !== undefined ? a.claim_cap : a.amount) - Number(leg.claim_cap !== undefined ? leg.claim_cap : leg.amount)) < 0.01 &&
        String(a.maturity_date || a.due_date).slice(0, 10) === String(leg.maturity_date || leg.due_date).slice(0, 10)
      )
    );
    if (!exists) {
      combined.push(leg);
    }
  }

  // Sort by created_at DESC, then maturity_date DESC (newest alerts first)
  combined.sort((a, b) => {
    const timeA = new Date(a.created_at || a.createdAt || 0).getTime();
    const timeB = new Date(b.created_at || b.createdAt || 0).getTime();
    if (timeB && timeA && timeB !== timeA) return timeB - timeA;
    const dateA = new Date(a.maturity_date || a.due_date || 0).getTime();
    const dateB = new Date(b.maturity_date || b.due_date || 0).getTime();
    if (dateB !== dateA) return dateB - dateA;
    return (Number(b.id) || 0) - (Number(a.id) || 0);
  });

  let filtered = combined;
  if (status) {
    filtered = filtered.filter(a => (a.status || '').toLowerCase() === status.toLowerCase());
  }
  if (search) {
    const s = search.toLowerCase();
    filtered = filtered.filter(a =>
      (a.memo_label && a.memo_label.toLowerCase().includes(s)) ||
      (a.target_contact && a.target_contact.toLowerCase().includes(s)) ||
      (a.title && a.title.toLowerCase().includes(s)) ||
      (a.person_name && a.person_name.toLowerCase().includes(s))
    );
  }

  return sendSuccess(res, filtered, 'All people repayment alerts fetched', 200, {
    total: filtered.length,
    page: 1,
    limit: filtered.length
  });
};

// Create Repayment Alert (PostgreSQL persistence)
const createRepaymentAlert = async (req, res) => {
  const {
    target_contact,
    person_name,
    contact_id,
    person_id,
    contact_phone,
    maturity_date,
    due_date,
    memo_label,
    title,
    claim_cap,
    amount,
    status = 'Pending'
  } = req.body;

  const resolvedMaturityDate = maturity_date || due_date;
  const resolvedMemo = memo_label || title || 'Repayment Alert';
  const resolvedContactId = contact_id || person_id || null;
  const rawCap = claim_cap !== undefined ? claim_cap : (amount !== undefined ? amount : 0);

  if (!resolvedMaturityDate) {
    return sendError(res, 'Maturity / Due Date is required', 400, 'BAD_REQUEST');
  }

  // 12-digit cap validation (max 999999999999.99)
  const parsedCap = Number(rawCap) || 0;
  if (isNaN(parsedCap) || parsedCap < 0 || parsedCap > 999999999999.99) {
    return sendError(res, 'Claim cap must be between 0 and 999,999,999,999.99', 400, 'BAD_REQUEST');
  }

  let resolvedTargetContact = target_contact || person_name || null;
  let resolvedPhone = contact_phone || null;

  if (resolvedContactId && (!resolvedTargetContact || !resolvedPhone)) {
    try {
      const contact = await db.prepare('SELECT name, phone FROM people WHERE id = ? AND user_id = ?').get(resolvedContactId, req.user.id);
      if (contact) {
        if (!resolvedTargetContact) resolvedTargetContact = contact.name;
        if (!resolvedPhone) resolvedPhone = contact.phone;
      }
    } catch (e) {}
  }

  if (!resolvedTargetContact) {
    resolvedTargetContact = 'Contact';
  }

  // Idempotency check: Reject duplicate concurrent requests within 5 seconds for the same contact/date/memo/cap
  try {
    const recentAlert = await db.prepare(`
      SELECT * FROM repayment_alerts
      WHERE user_id = ? AND (contact_id = ? OR target_contact = ?) AND memo_label = ? AND maturity_date = ?
      ORDER BY id DESC LIMIT 1
    `).get(req.user.id, resolvedContactId, resolvedTargetContact, resolvedMemo, resolvedMaturityDate);
    if (recentAlert && recentAlert.created_at) {
      const diffMs = Date.now() - new Date(recentAlert.created_at).getTime();
      if (diffMs >= 0 && diffMs < 5000) {
        return sendSuccess(res, recentAlert, 'Repayment alert created (idempotent)', 200);
      }
    }

    if (resolvedContactId) {
      const recent = await db.prepare(`
        SELECT * FROM people_reminders
        WHERE person_id = ? AND user_id = ? AND title = ? AND due_date = ?
        ORDER BY id DESC LIMIT 1
      `).get(resolvedContactId, req.user.id, resolvedMemo, resolvedMaturityDate);

      if (recent && recent.created_at) {
        const diffMs = Date.now() - new Date(recent.created_at).getTime();
        if (diffMs >= 0 && diffMs < 5000) {
          return sendSuccess(res, recent, 'Repayment alert created (idempotent)', 200);
        }
      }
    }
  } catch (e) {}

  const alert = await RepaymentAlert.create({
    user_id: req.user.id,
    business_id: req.user.business_id || null,
    contact_id: resolvedContactId,
    target_contact: resolvedTargetContact,
    contact_phone: resolvedPhone,
    maturity_date: resolvedMaturityDate,
    memo_label: resolvedMemo,
    claim_cap: parsedCap,
    status
  });

  // Also write to legacy people_reminders if person_id is available
  if (resolvedContactId) {
    try {
      const now = new Date().toISOString();
      await db.prepare(`
        INSERT INTO people_reminders (person_id, user_id, title, message, amount, due_date, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(resolvedContactId, req.user.id, resolvedMemo, resolvedMemo, parsedCap, resolvedMaturityDate, status.toLowerCase(), now, now);
    } catch (e) {}
  }

  return sendSuccess(res, alert, 'Repayment alert created', 201);
};

// Delete Repayment Alert
const deleteRepaymentAlert = async (req, res) => {
  const { id } = req.params;
  await RepaymentAlert.delete(id, req.user.id);
  try {
    await db.prepare('DELETE FROM people_reminders WHERE id = ? AND user_id = ?').run(id, req.user.id);
  } catch (e) {}
  return sendSuccess(res, { deleted: true }, 'Repayment alert removed');
};

// Update Repayment Alert Status
const updateRepaymentAlert = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (status) {
    await RepaymentAlert.updateStatus(id, req.user.id, status);
    try {
      await db.prepare('UPDATE people_reminders SET status = ? WHERE id = ? AND user_id = ?').run(status.toLowerCase(), id, req.user.id);
    } catch (e) {}
  }
  return sendSuccess(res, { id, status }, 'Repayment alert updated');
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

  const stats = await db.prepare(`
    SELECT 
      COUNT(*) as total_records
    FROM people_records
    WHERE user_id = ?
  `).get(req.user.id);

  return sendSuccess(res, result.rows, 'All people records fetched', 200, { ...result.meta, stats });
};

let isPeopleStatusColumnEnsured = false;
const ensurePeopleSchema = async () => {
  if (isPeopleStatusColumnEnsured) return;
  try {
    await db.prepare("ALTER TABLE people ADD COLUMN status TEXT DEFAULT 'accepted'").run();
  } catch (_) {}
  isPeopleStatusColumnEnsured = true;
};

const getPeople = async (req, res) => {
  await ensurePeopleSchema();
  const { page, limit, sort = 'updated_at', order = 'desc', search, role_type } = req.query;
  
  let query = `
    SELECT p.*,
      COALESCE(p.status, 'accepted') as status,
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
    query += ' AND (p.name LIKE ? OR p.company LIKE ? OR p.contact_info LIKE ? OR p.email LIKE ?)'; 
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`); 
  }

  query += ' GROUP BY p.id';

  const allowedSorts = ['created_at', 'updated_at', 'name', 'company', 'net_balance'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'updated_at';
  const sortDir = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  query += ` ORDER BY ${sortCol} ${sortDir}, p.created_at DESC, p.id DESC`;

  const result = await paginate(query, params, page, limit, db);

  const summary = await db.prepare(`
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
    ) AS balance_sub
  `).get(req.user.id);

  return sendSuccess(res, result.rows, 'People fetched', 200, { ...result.meta, summary });
};

const createPerson = async (req, res) => {
  await ensurePeopleSchema();
  const { name, role_type, relationship, phone, email, company, contact_info, notes } = req.body;
  if (!name || !role_type) return sendError(res, 'Name and role_type are required', 400, 'BAD_REQUEST');

  // 1. Strict BNXMAIL Validation & Requirement
  const cleanEmail = email ? email.trim().toLowerCase() : '';
  if (!cleanEmail) {
    return sendError(res, 'Email address is required. Only @bnxmail.com domain addresses are accepted.', 400, 'BAD_REQUEST');
  }

  const bnxmailRegex = /^[a-zA-Z0-9._%+-]+@bnxmail\.com$/i;
  if (!bnxmailRegex.test(cleanEmail)) {
    return sendError(res, 'Only official @bnxmail.com domain emails are permitted.', 400, 'BAD_REQUEST');
  }

  // Prevent user from sending request to themselves
  const currentUser = await db.prepare('SELECT id, email, username, business_name FROM users WHERE id = ?').get(req.user.id);
  const senderEmail = (currentUser?.email || '').toLowerCase().trim();
  const tokenEmail = (req.user?.email || '').toLowerCase().trim();
  if ((senderEmail && cleanEmail === senderEmail) || (tokenEmail && cleanEmail === tokenEmail)) {
    return sendError(res, 'You cannot send a connection request to your own @bnxmail.com address.', 400, 'BAD_REQUEST');
  }

  // Check if contact with this email already exists in user's directory
  const existingEmail = await db.prepare('SELECT id, status FROM people WHERE user_id = ? AND LOWER(email) = LOWER(?)').get(req.user.id, cleanEmail);
  if (existingEmail) {
    if (existingEmail.status === 'pending') {
      return sendError(res, 'A connection request to this @bnxmail.com address is already pending.', 409, 'CONFLICT');
    }
    return sendError(res, 'A contact with this @bnxmail.com address already exists in your network.', 409, 'CONFLICT');
  }

  // 2. Unique Phone Number Check
  if (phone && phone.trim()) {
    const existingPhone = await db.prepare('SELECT id FROM people WHERE user_id = ? AND phone = ?').get(req.user.id, phone.trim());
    if (existingPhone) {
      return sendError(res, 'Phone number must be unique. A contact with this mobile number already exists.', 409, 'CONFLICT');
    }
  }

  const now = new Date().toISOString();
  const status = 'pending';
  const stmt = db.prepare(`
    INSERT INTO people (user_id, name, role_type, relationship, phone, email, company, contact_info, notes, status, created_at, updated_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = await stmt.run(req.user.id, name, role_type, relationship || null, phone ? phone.trim() : null, cleanEmail, company || null, contact_info || null, notes || null, status, now, now);
  
  const newItem = await db.prepare('SELECT * FROM people WHERE id = ?').get(info.lastInsertRowid);
  return sendSuccess(res, newItem, 'Person created and invitation request sent', 201);
};

const getPerson = async (req, res) => {
  await ensurePeopleSchema();
  const person = await db.prepare('SELECT * FROM people WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!person) return sendError(res, 'Person not found', 404, 'NOT_FOUND');
  return sendSuccess(res, person);
};

const updatePerson = async (req, res) => {
  await ensurePeopleSchema();
  const person = await db.prepare('SELECT * FROM people WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!person) return sendError(res, 'Person not found', 404, 'NOT_FOUND');

  const { phone, email } = req.body;

  // 1. BNXMAIL Domain Validation if email is updated
  if (email !== undefined && email !== null && email.trim() !== '') {
    const cleanEmail = email.trim().toLowerCase();
    const emailRegex = /^[a-zA-Z0-9._%+-]+@bnxmail\.com$/i;
    if (!emailRegex.test(cleanEmail)) {
      return sendError(res, 'Only official @bnxmail.com domain emails are permitted.', 400, 'BAD_REQUEST');
    }

    const currentUser = await db.prepare('SELECT id, email FROM users WHERE id = ?').get(req.user.id);
    const senderEmail = (currentUser?.email || '').toLowerCase().trim();
    const tokenEmail = (req.user?.email || '').toLowerCase().trim();
    if ((senderEmail && cleanEmail === senderEmail) || (tokenEmail && cleanEmail === tokenEmail)) {
      return sendError(res, 'You cannot set a contact to your own @bnxmail.com address.', 400, 'BAD_REQUEST');
    }
  }

  // 2. Unique Phone Number Check if phone is updated
  if (phone !== undefined && phone !== null && phone.trim() !== '') {
    const existingPhone = await db.prepare('SELECT id FROM people WHERE user_id = ? AND phone = ? AND id != ?').get(req.user.id, phone.trim(), req.params.id);
    if (existingPhone) {
      return sendError(res, 'Phone number must be unique. A contact with this mobile number already exists.', 409, 'CONFLICT');
    }
  }

  const updates = [];
  const params = [];
  const allowedFields = ['name', 'role_type', 'relationship', 'phone', 'email', 'company', 'contact_info', 'notes', 'status'];
  
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      params.push(typeof req.body[field] === 'string' ? req.body[field].trim() : req.body[field]);
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

// ── Connection Requests Workflow ──────────────────────────────────────────────
const getIncomingRequests = async (req, res) => {
  await ensurePeopleSchema();
  const currentUser = await db.prepare('SELECT id, email, username, business_name FROM users WHERE id = ?').get(req.user.id);
  const userEmail = (currentUser?.email || req.user?.email || '').toLowerCase().trim();

  if (!userEmail) {
    return sendSuccess(res, [], 'No incoming requests');
  }

  const incoming = await db.prepare(`
    SELECT 
      p.id,
      p.user_id as requester_id,
      p.name as invited_as_name,
      p.role_type,
      p.relationship,
      p.company,
      p.created_at,
      p.status,
      u.username as requester_username,
      u.email as requester_email,
      u.business_name as requester_business_name
    FROM people p
    JOIN users u ON p.user_id = u.id
    WHERE LOWER(p.email) = LOWER(?) AND (p.status = 'pending' OR p.status IS NULL)
    ORDER BY p.created_at DESC
  `).all(userEmail);

  return sendSuccess(res, incoming || [], 'Incoming connection requests fetched');
};

const respondToRequest = async (req, res) => {
  await ensurePeopleSchema();
  const { action } = req.body;
  if (!action || !['accept', 'reject', 'accepted', 'rejected'].includes(action)) {
    return sendError(res, "Action must be 'accept' or 'reject'", 400, 'BAD_REQUEST');
  }

  const normalizedStatus = (action === 'accept' || action === 'accepted') ? 'accepted' : 'rejected';

  const requestItem = await db.prepare(`
    SELECT p.*, u.username as requester_username, u.email as requester_email, u.business_name as requester_business_name
    FROM people p
    JOIN users u ON p.user_id = u.id
    WHERE p.id = ?
  `).get(req.params.id);

  if (!requestItem) {
    return sendError(res, 'Connection request not found', 404, 'NOT_FOUND');
  }

  const currentUser = await db.prepare('SELECT id, email, username, business_name FROM users WHERE id = ?').get(req.user.id);
  const userEmail = (currentUser?.email || req.user?.email || '').toLowerCase().trim();

  if ((requestItem.email || '').toLowerCase().trim() !== userEmail) {
    return sendError(res, 'You are not authorized to respond to this connection request', 403, 'FORBIDDEN');
  }

  const now = new Date().toISOString();
  await db.prepare('UPDATE people SET status = ?, updated_at = ? WHERE id = ?').run(normalizedStatus, now, req.params.id);

  if (normalizedStatus === 'accepted') {
    // Automatically establish reciprocal contact for the recipient so both users are connected
    try {
      const recipientUser = await db.prepare('SELECT id FROM users WHERE id = ?').get(req.user.id);
      if (recipientUser && requestItem.requester_email) {
        const reciprocal = await db.prepare('SELECT id FROM people WHERE user_id = ? AND LOWER(email) = LOWER(?)').get(req.user.id, requestItem.requester_email);
        if (!reciprocal) {
          const contactName = requestItem.requester_business_name || requestItem.requester_username || 'Connected Contact';
          await db.prepare(`
            INSERT INTO people (user_id, name, role_type, relationship, email, status, created_at, updated_at)
            VALUES (?, ?, 'business', 'Connected Network', ?, 'accepted', ?, ?)
          `).run(req.user.id, contactName, requestItem.requester_email.toLowerCase().trim(), now, now);
        } else {
          await db.prepare('UPDATE people SET status = ?, updated_at = ? WHERE id = ?').run('accepted', now, reciprocal.id);
        }
      }
    } catch (e) {
      console.warn('Reciprocal contact creation warning:', e.message);
    }
  }

  const updatedItem = await db.prepare('SELECT * FROM people WHERE id = ?').get(req.params.id);
  return sendSuccess(res, updatedItem, `Connection request ${normalizedStatus}`);
};

module.exports = {
  getAllTransactions,
  getAllReminders,
  createRepaymentAlert,
  deleteRepaymentAlert,
  updateRepaymentAlert,
  getAllRecords,
  getPeople,
  createPerson,
  getPerson,
  updatePerson,
  deletePerson,
  getIncomingRequests,
  respondToRequest
};
