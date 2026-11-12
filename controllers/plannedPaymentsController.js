const db = require('../db/connection');
const axios = require('axios');
const { sendSuccess, sendError } = require('../utils/response');
const { paginate } = require('../utils/pagination');

// Auto-run schema migrations to ensure all required fields exist
const initTable = async () => {
  try {
    const rawDb = db.raw || db;
    try { await rawDb.exec('ALTER TABLE planned_payments ADD COLUMN description TEXT'); } catch (e) {}
    try { await rawDb.exec("ALTER TABLE planned_payments ADD COLUMN frequency TEXT DEFAULT 'one_time'"); } catch (e) {}
    try { await rawDb.exec('ALTER TABLE planned_payments ADD COLUMN last_reminder_at TEXT'); } catch (e) {}
  } catch (err) {
    console.warn('[Planned Payments Controller] Table init note:', err.message);
  }
};
initTable();

// Calculate next due date for recurring payments (e.g. monthly for rent)
const calculateNextDueDate = (currentDueDateStr, frequency = 'monthly') => {
  if (!currentDueDateStr) return null;
  const date = new Date(currentDueDateStr);
  if (isNaN(date.getTime())) return null;

  const freq = String(frequency || '').toLowerCase();
  if (freq === 'weekly') {
    date.setDate(date.getDate() + 7);
  } else if (freq === 'quarterly') {
    date.setMonth(date.getMonth() + 3);
  } else if (freq === 'yearly') {
    date.setFullYear(date.getFullYear() + 1);
  } else {
    // Default to monthly (Rent, EMI, Retainers)
    date.setMonth(date.getMonth() + 1);
  }

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// Send email notification to user and linked contact via BNX Mail API
const sendPlannedPaymentNotification = async ({ user, person, payment, actionType = 'SCHEDULED', nextPayment = null, authHeader = null }) => {
  const recipientEmails = [];
  if (user?.email && user.email.includes('@')) {
    recipientEmails.push(user.email);
  }
  if (person?.email && person.email.includes('@') && !recipientEmails.includes(person.email)) {
    recipientEmails.push(person.email);
  }

  if (recipientEmails.length === 0) {
    console.log('[Planned Payment Notification] No recipient emails found, skipping mail send.');
    return;
  }

  const isSend = String(payment.type || 'SEND').toUpperCase() === 'SEND';
  const typeLabel = isSend ? 'Outgoing Payment (Sending)' : 'Incoming Payment (Receiving)';
  const formattedAmount = `₹${Number(payment.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const frequencyLabel = payment.frequency === 'monthly' ? 'Monthly (Recurring e.g. Rent, EMI)' 
    : payment.frequency === 'weekly' ? 'Weekly' 
    : payment.frequency === 'yearly' ? 'Yearly' 
    : payment.frequency === 'quarterly' ? 'Quarterly'
    : 'One-Time';

  let subject = '';
  let heading = '';
  let subtext = '';

  if (actionType === 'SCHEDULED') {
    subject = `[CLIKS Planner] Scheduled Payment: ${payment.name} (${formattedAmount})`;
    heading = `Payment Scheduled: ${payment.name}`;
    subtext = payment.frequency === 'monthly'
      ? `A new recurring monthly payment has been scheduled in your CLIKS Business Payments Planner.`
      : `A new payment has been scheduled in your CLIKS Business Payments Planner.`;
  } else if (actionType === 'PAID_RECURRING') {
    subject = `[CLIKS Planner] Payment Marked as Paid: ${payment.name} (Next Cycle Scheduled)`;
    heading = `Payment Completed & Next Cycle Scheduled`;
    subtext = `Payment of ${formattedAmount} for "${payment.name}" was marked as paid. The next monthly recurring cycle due on ${nextPayment?.due_date || 'next month'} has been automatically scheduled!`;
  } else if (actionType === 'PAID') {
    subject = `[CLIKS Planner] Payment Completed: ${payment.name} (${formattedAmount})`;
    heading = `Payment Completed: ${payment.name}`;
    subtext = `Payment of ${formattedAmount} for "${payment.name}" has been marked as paid.`;
  } else if (actionType === 'REMINDER') {
    subject = `[CLIKS Reminder] Payment Due: ${payment.name} (${formattedAmount})`;
    heading = `Upcoming Payment Reminder: ${payment.name}`;
    subtext = `This is a friendly reminder that your planned payment of ${formattedAmount} is due on ${payment.due_date}.`;
  }

  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px; color: #1e293b; }
        .card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
        .header { background: linear-gradient(135deg, #1B6B3A 0%, #064E3B 100%); padding: 28px 24px; text-align: center; color: #ffffff; }
        .header h1 { margin: 0 0 6px 0; font-size: 22px; font-weight: 800; letter-spacing: -0.02em; }
        .header p { margin: 0; font-size: 13px; opacity: 0.9; }
        .body { padding: 24px; }
        .badge { display: inline-block; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 700; text-transform: uppercase; }
        .badge-send { background: #fee2e2; color: #dc2626; }
        .badge-receive { background: #dcfce7; color: #16a34a; }
        .badge-recurring { background: #f5f3ff; color: #7c3aed; border: 1px solid #ddd6fe; margin-left: 6px; }
        .amount-box { text-align: center; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 18px; margin: 20px 0; }
        .amount-val { font-size: 32px; font-weight: 900; color: #166534; margin: 4px 0 0 0; }
        .details-table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 14px; }
        .details-table td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; }
        .details-table td.label { font-weight: 700; color: #64748b; width: 38%; }
        .details-table td.value { font-weight: 600; color: #0f172a; }
        .footer { background: #f8fafc; padding: 18px 24px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #f1f5f9; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <h1>CLIKS Payments Planner</h1>
          <p>${heading}</p>
        </div>
        <div class="body">
          <p style="font-size: 15px; line-height: 1.5; margin: 0 0 16px 0;">${subtext}</p>
          <div class="amount-box">
            <span style="font-size: 12px; font-weight: 800; color: #15803d; text-transform: uppercase; letter-spacing: 0.05em;">Payment Amount</span>
            <div class="amount-val">${formattedAmount}</div>
          </div>
          <table class="details-table">
            <tr>
              <td class="label">Reference / Name</td>
              <td class="value"><strong>${payment.name}</strong></td>
            </tr>
            <tr>
              <td class="label">Transaction Flow</td>
              <td class="value">
                <span class="badge ${isSend ? 'badge-send' : 'badge-receive'}">${typeLabel}</span>
                ${payment.frequency && payment.frequency !== 'one_time' ? `<span class="badge badge-recurring">🔄 ${frequencyLabel}</span>` : ''}
              </td>
            </tr>
            <tr>
              <td class="label">Due Date</td>
              <td class="value"><strong>${payment.due_date}</strong></td>
            </tr>
            <tr>
              <td class="label">Frequency</td>
              <td class="value">${frequencyLabel}</td>
            </tr>
            ${payment.category ? `<tr><td class="label">Category</td><td class="value">${payment.category}</td></tr>` : ''}
            ${person?.name ? `<tr><td class="label">Linked Contact</td><td class="value">${person.name}${person.email ? ` (${person.email})` : ''}</td></tr>` : ''}
            ${nextPayment?.due_date ? `<tr><td class="label">Next Recurring Cycle</td><td class="value" style="color: #16a34a; font-weight: 800;">${nextPayment.due_date}</td></tr>` : ''}
          </table>
          ${payment.frequency === 'monthly' ? `
            <div style="background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 10px; padding: 12px; margin-top: 18px; font-size: 13px; color: #6b21a8;">
              💡 <strong>Monthly Recurring Protection:</strong> This payment (e.g. Rent, EMI, Retainer) repeats every month. When you mark this month's payment as paid in CLIKS, the next monthly cycle will automatically be scheduled.
            </div>
          ` : ''}
        </div>
        <div class="footer">
          Generated automatically by CLIKS Business Platform • Payments & Financial Planner<br>
          Keep your business finances, rent, and scheduled transfers organized seamlessly.
        </div>
      </div>
    </body>
    </html>
  `;

  // Send via BNX Mail API (matching marketingController.js and mailController.js)
  try {
    let auth = authHeader;
    if (auth && !auth.startsWith('Bearer ')) {
      auth = `Bearer ${auth}`;
    }

    await axios.post('https://api.bnxmail.com/api/mail/bulk-send', {
      recipients: recipientEmails,
      subject,
      body: htmlBody,
      isHtml: true
    }, {
      headers: auth ? { 'Authorization': auth, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
      timeout: 8000
    }).catch(e => {
      console.log('[Planned Payment Mail Note]:', e.message);
    });
    console.log(`[Planned Payment Notification] Dispatched "${subject}" to ${recipientEmails.join(', ')}`);
  } catch (err) {
    console.warn('[Planned Payment Notification Warning]:', err.message);
  }

  // Create in-app notification record
  try {
    const notifTitle = heading;
    const notifMsg = `${payment.name} (${formattedAmount}) scheduled for ${payment.due_date}.`;
    await db.prepare(`
      INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
      VALUES (?, ?, ?, 'payment_plan', 0, ?)
    `).run(user.id, notifTitle, notifMsg, new Date().toISOString());
  } catch (e) {}

  // Live Socket.IO Broadcast
  try {
    const { getIO } = require('../socketServer');
    const io = getIO();
    if (io) {
      io.emit('new-notification', { 
        userId: user.id, 
        title: heading, 
        message: `${payment.name} (${formattedAmount}) scheduled for ${payment.due_date}.` 
      });
      io.emit('planned-payment-update', { paymentId: payment.id, status: payment.status });
    }
  } catch (e) {}
};

// Background scheduler checking for due planned payments and sending reminders
const autoCheckDuePlannedPayments = async () => {
  try {
    const todayStr = new Date().toISOString().split('T')[0];
    const duePayments = await db.prepare(`
      SELECT pp.*, u.email as user_email, u.username, p.name as person_name, p.email as person_email
      FROM planned_payments pp
      JOIN users u ON pp.user_id = u.id
      LEFT JOIN people p ON pp.person_id = p.id
      WHERE pp.status = 'pending' AND pp.due_date <= ? AND (pp.last_reminder_at IS NULL OR pp.last_reminder_at != ?)
    `).all(todayStr, todayStr);

    if (!duePayments || duePayments.length === 0) return;

    for (const p of duePayments) {
      await db.prepare('UPDATE planned_payments SET last_reminder_at = ? WHERE id = ?').run(todayStr, p.id);
      sendPlannedPaymentNotification({
        user: { id: p.user_id, username: p.username, email: p.user_email },
        person: p.person_name ? { name: p.person_name, email: p.person_email } : null,
        payment: p,
        actionType: 'REMINDER'
      });
    }
  } catch (err) {
    // Background reminder check note
  }
};
setInterval(autoCheckDuePlannedPayments, 60000);

const getPlannedPayments = async (req, res) => {
  const { status, category, page, limit, sort = 'created_at', order = 'desc', search, frequency } = req.query;
  let query = `
    SELECT pp.*, p.name as person_name, p.email as person_email, p.phone as person_phone 
    FROM planned_payments pp 
    LEFT JOIN people p ON pp.person_id = p.id 
    WHERE pp.user_id = ?
  `;
  const params = [req.user.id];

  if (status) { query += ' AND pp.status = ?'; params.push(status); }
  if (category) { query += ' AND pp.category LIKE ?'; params.push(`%${category}%`); }
  if (frequency) { query += ' AND pp.frequency = ?'; params.push(frequency); }
  if (search) { 
    query += ' AND (pp.name LIKE ? OR p.name LIKE ? OR pp.category LIKE ?)'; 
    params.push(`%${search}%`, `%${search}%`, `%${search}%`); 
  }
  if (req.query.type) { query += ' AND pp.type = ?'; params.push(req.query.type); }
  if (req.query.person_id) { query += ' AND pp.person_id = ?'; params.push(req.query.person_id); }

  const allowedSorts = ['created_at', 'updated_at', 'amount', 'due_date'];
  const sortCol = allowedSorts.includes(sort) ? `pp.${sort}` : 'pp.created_at';
  const sortDir = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  query += ` ORDER BY ${sortCol} ${sortDir}`;

  const result = await paginate(query, params, page, limit, db);
  return sendSuccess(res, result.rows, 'Planned payments fetched', 200, result.meta);
};

const createPlannedPayment = async (req, res) => {
  const { account_id, name, amount, due_date, frequency, category, status = 'pending', type, person_id, description, notes, remark } = req.body;
  if (!name || amount === undefined || amount === null || !due_date) return sendError(res, 'Name, amount, and due_date are required', 400, 'BAD_REQUEST');

  const numAmount = parseFloat(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    return sendError(res, 'Payment amount must be a positive number greater than 0', 400, 'BAD_REQUEST');
  }

  // Auto-detect monthly frequency if name or category specifies 'rent' and frequency is not explicitly passed
  let resolvedFrequency = frequency || 'one_time';
  const lowerName = String(name || '').toLowerCase();
  const lowerCat = String(category || '').toLowerCase();
  if (!frequency && (lowerName.includes('rent') || lowerCat.includes('rent'))) {
    resolvedFrequency = 'monthly';
  }

  const resolvedDescription = description || notes || remark || null;
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO planned_payments (user_id, account_id, name, description, amount, due_date, frequency, category, status, type, person_id, created_at, updated_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = await stmt.run(req.user.id, account_id || null, name, resolvedDescription, numAmount, due_date, resolvedFrequency, category || null, status, type || 'SEND', person_id || null, now, now);
  
  const newItem = await db.prepare('SELECT * FROM planned_payments WHERE id = ?').get(info.lastInsertRowid);

  // Send email notification to user and linked contact
  try {
    const user = await db.prepare('SELECT id, username, email FROM users WHERE id = ?').get(req.user.id);
    let person = null;
    if (person_id) {
      person = await db.prepare('SELECT id, name, email, phone FROM people WHERE id = ?').get(person_id);
    }
    const token = req.headers['authorization'] || req.headers['x-auth-token'];
    sendPlannedPaymentNotification({
      user,
      person,
      payment: newItem,
      actionType: 'SCHEDULED',
      authHeader: token
    });
  } catch (err) {
    console.warn('[Planned Payment Controller] Notification dispatch note:', err.message);
  }

  return sendSuccess(res, newItem, 'Planned payment created and email notification dispatched', 201);
};

const getPlannedPayment = async (req, res) => {
  const item = await db.prepare(`
    SELECT pp.*, p.name as person_name, p.email as person_email, p.phone as person_phone 
    FROM planned_payments pp 
    LEFT JOIN people p ON pp.person_id = p.id 
    WHERE pp.id = ? AND pp.user_id = ?
  `).get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Planned payment not found', 404, 'NOT_FOUND');
  return sendSuccess(res, item);
};

const updatePlannedPayment = async (req, res) => {
  const item = await db.prepare('SELECT * FROM planned_payments WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Planned payment not found', 404, 'NOT_FOUND');

  if (req.body.amount !== undefined) {
    const numAmount = parseFloat(req.body.amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return sendError(res, 'Payment amount must be a positive number greater than 0', 400, 'BAD_REQUEST');
    }
  }

  const updates = [];
  const params = [];
  const allowedFields = ['account_id', 'name', 'description', 'amount', 'due_date', 'frequency', 'category', 'status', 'type', 'person_id'];
  
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      params.push(field === 'amount' ? parseFloat(req.body[field]) : req.body[field]);
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
  await db.prepare(`UPDATE planned_payments SET status = 'paid', updated_at = ? WHERE id = ? AND user_id = ?`)
    .run(now, req.params.id, req.user.id);

  const updatedItem = await db.prepare('SELECT * FROM planned_payments WHERE id = ?').get(req.params.id);

  let nextRecurringItem = null;
  const isRecurring = item.frequency && item.frequency !== 'one_time' && item.frequency !== 'none';
  if (isRecurring) {
    const nextDueDate = calculateNextDueDate(item.due_date, item.frequency);
    if (nextDueDate) {
      const nextStmt = db.prepare(`
        INSERT INTO planned_payments (user_id, account_id, name, description, amount, due_date, frequency, category, status, type, person_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
      `);
      const nextInfo = await nextStmt.run(
        req.user.id, item.account_id, item.name, item.description, item.amount, nextDueDate, item.frequency, item.category, item.type, item.person_id, now, now
      );
      nextRecurringItem = await db.prepare('SELECT * FROM planned_payments WHERE id = ?').get(nextInfo.lastInsertRowid);
      console.log(`[Recurring Payment] Advanced monthly/recurring payment #${item.id} -> #${nextRecurringItem.id} due on ${nextDueDate}`);
    }
  }

  // Send paid & next recurring cycle notification
  try {
    const user = await db.prepare('SELECT id, username, email FROM users WHERE id = ?').get(req.user.id);
    let person = null;
    if (item.person_id) {
      person = await db.prepare('SELECT id, name, email, phone FROM people WHERE id = ?').get(item.person_id);
    }
    const token = req.headers['authorization'] || req.headers['x-auth-token'];
    sendPlannedPaymentNotification({
      user,
      person,
      payment: updatedItem,
      actionType: isRecurring ? 'PAID_RECURRING' : 'PAID',
      nextPayment: nextRecurringItem,
      authHeader: token
    });
  } catch (err) {
    console.warn('[Planned Payment Controller] Paid notification note:', err.message);
  }

  return sendSuccess(res, { 
    ...updatedItem, 
    nextRecurringPayment: nextRecurringItem 
  }, isRecurring ? `Payment marked as paid and next monthly payment scheduled for ${nextRecurringItem?.due_date}` : 'Planned payment marked as paid');
};

const deletePlannedPayment = async (req, res) => {
  const item = await db.prepare('SELECT * FROM planned_payments WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Planned payment not found', 404, 'NOT_FOUND');

  await db.prepare('DELETE FROM planned_payments WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  return res.status(204).end();
};

module.exports = { 
  getPlannedPayments, 
  createPlannedPayment, 
  getPlannedPayment, 
  updatePlannedPayment, 
  markPlannedPaymentPaid, 
  deletePlannedPayment 
};
