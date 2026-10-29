const path = require('path');
const fs = require('fs');
const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

const BNX_EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@bnxmail\.com$/i;

// Helper to normalize participant objects and guarantee backward compatibility
const normalizeParticipant = (p, defaultRole = 'viewer', defaultStatus = 'pending', isAdmin = false) => {
  if (typeof p === 'string') {
    const emailMatch = p.match(/\(([^)]+@bnxmail\.com)\)/i);
    const email = emailMatch ? emailMatch[1] : (p.includes('@bnxmail.com') ? p : '');
    const name = p.replace(/\s*\([^)]+@bnxmail\.com\)/i, '').trim();
    const isYou = name.toLowerCase() === 'you';
    return {
      name: name || 'Participant',
      email: email || '',
      role: (isYou || isAdmin) ? 'admin' : defaultRole,
      status: isYou ? 'accepted' : defaultStatus,
      isAdmin: isYou || isAdmin
    };
  }
  const isAdm = !!p.isAdmin || p.role === 'admin' || isAdmin;
  return {
    name: p.name || (p.email ? p.email.split('@')[0] : 'Member'),
    email: p.email || '',
    role: isAdm ? 'admin' : (p.role === 'editor' ? 'editor' : 'viewer'),
    status: p.status || defaultStatus,
    isAdmin: isAdm
  };
};

// ── GET / ─────────────────────────────────────────────────────────────────────
const getSplitExpenses = async (req, res) => {
  try {
    const userEmail = (req.user?.email || '').toLowerCase();
    const userId = req.user?.id;
    const allTickets = await db.prepare("SELECT * FROM split_tickets ORDER BY created_at DESC").all();
    
    // Creator or invited member whose bnxmail is present in participants
    const tickets = allTickets.filter(ticket => {
      if (ticket.user_id == userId) return true;
      try {
        const parts = JSON.parse(ticket.participants || '[]');
        return parts.some(p => {
          const pEmail = (typeof p === 'string' ? (p.match(/\(([^)]+@bnxmail\.com)\)/i)?.[1] || (p.includes('@') ? p : '')) : (p.email || '')).toLowerCase();
          return pEmail && pEmail === userEmail;
        });
      } catch (e) {
        return false;
      }
    });

    for (const ticket of tickets) {
      try {
        const rawParts = JSON.parse(ticket.participants || '[]');
        ticket.participants = rawParts.map(p => normalizeParticipant(p));
      } catch (e) {
        ticket.participants = [];
      }
      ticket.currencySymbol = ticket.currency_symbol;
      delete ticket.currency_symbol;

      const expenses = await db.prepare("SELECT * FROM split_ticket_expenses WHERE split_ticket_id = ? ORDER BY created_at DESC").all(ticket.id);
      for (const exp of expenses) {
        try {
          exp.shares = JSON.parse(exp.shares || '{}');
        } catch (e) {
          exp.shares = {};
        }
        exp.paidBy = exp.paid_by;
        delete exp.paid_by;
        exp.splitType = exp.split_type;
        delete exp.split_type;
        exp.amount = parseFloat(exp.amount) || 0;
        exp.documentName = exp.document_name || (exp.attachment ? path.basename(exp.attachment).replace(/^\d+_/, '') : '');
        exp.documentUrl = exp.document_url || (exp.attachment ? (exp.attachment.startsWith('/') ? exp.attachment : `/uploads/${exp.attachment}`) : '');
        delete exp.document_name;
        delete exp.document_url;
        if (!exp.attachment && exp.documentUrl) {
          exp.attachment = exp.documentUrl;
        }
      }
      ticket.expenses = expenses;
    }
    return sendSuccess(res, tickets, 'Split tickets fetched successfully');
  } catch (error) {
    console.error('Error fetching split tickets:', error);
    return sendError(res, error.message, 500);
  }
};

// ── POST / ────────────────────────────────────────────────────────────────────
const createSplitExpense = async (req, res) => {
  try {
    const { id, title, currency, currencySymbol, description, participants = [] } = req.body;
    if (!title) {
      return sendError(res, 'Title is required', 400, 'BAD_REQUEST');
    }

    // Validate email domain: Only official @bnxmail.com domain is permitted
    for (const p of participants) {
      const email = typeof p === 'string' 
        ? (p.match(/\(([^)]+@bnxmail\.com)\)/i)?.[1] || (p.includes('@') ? p : '')) 
        : (p.email || '');
      if (email && !BNX_EMAIL_REGEX.test(email.trim())) {
        return sendError(res, `Invalid email '${email}'. Only official @bnxmail.com domain emails are allowed.`, 400, 'INVALID_BNXMAIL');
      }
    }

    const ticketId = id || 'split-' + Date.now();
    const now = new Date().toISOString();

    const creatorEmail = (req.user?.email || 'admin@bnxmail.com').toLowerCase();
    const creatorName = req.user?.username || req.user?.name || 'You';

    const cleanParticipants = [];
    let hasAdmin = false;

    for (const p of participants) {
      const norm = normalizeParticipant(p, 'viewer', 'pending');
      if (norm.email && norm.email.toLowerCase() === creatorEmail) {
        norm.isAdmin = true;
        norm.role = 'admin';
        norm.status = 'accepted';
        hasAdmin = true;
      }
      if (norm.name.toLowerCase() === 'you') {
        norm.isAdmin = true;
        norm.role = 'admin';
        norm.status = 'accepted';
        norm.email = norm.email || creatorEmail;
        hasAdmin = true;
      }
      cleanParticipants.push(norm);
    }

    if (!hasAdmin) {
      cleanParticipants.unshift({
        name: creatorName,
        email: creatorEmail,
        role: 'admin',
        status: 'accepted',
        isAdmin: true
      });
    }

    await db.prepare(`
      INSERT INTO split_tickets (id, user_id, title, currency, currency_symbol, description, participants, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(ticketId, req.user.id, title, currency || 'INR', currencySymbol || '₹', description || '', JSON.stringify(cleanParticipants), now, now);

    const ticket = await db.prepare("SELECT * FROM split_tickets WHERE id = ?").get(ticketId);
    ticket.participants = JSON.parse(ticket.participants);
    ticket.currencySymbol = ticket.currency_symbol;
    delete ticket.currency_symbol;
    ticket.expenses = [];

    return sendSuccess(res, ticket, 'Split ticket created successfully', 201);
  } catch (error) {
    console.error('Error creating split ticket:', error);
    return sendError(res, error.message, 500);
  }
};

// ── DELETE /:id ───────────────────────────────────────────────────────────────
const deleteSplitExpense = async (req, res) => {
  try {
    const ticketId = req.params.id;
    const ticket = await db.prepare("SELECT * FROM split_tickets WHERE id = ?").get(ticketId);
    if (!ticket) return sendError(res, 'Split ticket not found', 404, 'NOT_FOUND');

    if (ticket.user_id != req.user.id) {
      return sendError(res, 'Only the split ticket admin can delete this ticket', 403, 'FORBIDDEN');
    }

    await db.transaction(async () => {
      await db.prepare("DELETE FROM split_ticket_expenses WHERE split_ticket_id = ?").run(ticketId);
      await db.prepare("DELETE FROM split_tickets WHERE id = ?").run(ticketId);
    })();
    return res.status(204).end();
  } catch (error) {
    console.error('Error deleting split ticket:', error);
    return sendError(res, error.message, 500);
  }
};

// ── POST /:id/expenses ────────────────────────────────────────────────────────
const createExpense = async (req, res) => {
  try {
    const { id, title, amount, paidBy, date, attachment, documentName, documentUrl, splitType, shares } = req.body;
    const splitTicketId = req.params.id;

    if (!title || amount === undefined) {
      return sendError(res, 'Title and amount are required', 400, 'BAD_REQUEST');
    }

    const ticket = await db.prepare("SELECT * FROM split_tickets WHERE id = ?").get(splitTicketId);
    if (!ticket) {
      return sendError(res, 'Split ticket not found', 404, 'NOT_FOUND');
    }

    // Access control check: Only Admin or Editor members who accepted can record expenses
    const isOwner = ticket.user_id == req.user.id;
    if (!isOwner) {
      let participants = [];
      try { participants = JSON.parse(ticket.participants || '[]'); } catch (e) {}
      const userEmail = (req.user?.email || '').toLowerCase();
      const member = participants.find(p => {
        const pEmail = (typeof p === 'string' ? (p.match(/\(([^)]+@bnxmail\.com)\)/i)?.[1] || (p.includes('@') ? p : '')) : (p.email || '')).toLowerCase();
        return pEmail && pEmail === userEmail;
      });

      if (!member) {
        return sendError(res, 'You are not a member of this split ticket', 403, 'FORBIDDEN');
      }

      const role = typeof member === 'object' ? (member.role || 'viewer') : 'editor';
      const status = typeof member === 'object' ? (member.status || 'pending') : 'accepted';

      if (status !== 'accepted') {
        return sendError(res, 'You must accept the split invitation before recording expenses', 403, 'INVITATION_PENDING');
      }

      if (role === 'viewer') {
        return sendError(res, 'You have view-only access to this split. Only editors can record expenses.', 403, 'VIEW_ONLY');
      }
    }

    const expId = id || 'exp-' + Date.now();
    const now = new Date().toISOString();

    const finalDocUrl = documentUrl || (attachment ? (attachment.startsWith('/') ? attachment : `/uploads/${attachment}`) : null);
    const finalDocName = documentName || (attachment ? path.basename(attachment).replace(/^\d+_/, '') : null);

    await db.prepare(`
      INSERT INTO split_ticket_expenses (id, split_ticket_id, user_id, title, amount, paid_by, date, attachment, document_name, document_url, split_type, shares, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      expId, 
      splitTicketId, 
      req.user.id, 
      title, 
      parseFloat(amount), 
      paidBy, 
      date || now.split('T')[0], 
      finalDocUrl || attachment || null, 
      finalDocName || null, 
      finalDocUrl || null, 
      splitType || 'equal', 
      JSON.stringify(shares || {}), 
      now, 
      now
    );

    const exp = await db.prepare("SELECT * FROM split_ticket_expenses WHERE id = ?").get(expId);
    exp.shares = JSON.parse(exp.shares);
    exp.paidBy = exp.paid_by;
    delete exp.paid_by;
    exp.splitType = exp.split_type;
    delete exp.split_type;
    exp.amount = parseFloat(exp.amount) || 0;
    exp.documentName = exp.document_name || finalDocName || '';
    exp.documentUrl = exp.document_url || finalDocUrl || exp.attachment || '';
    delete exp.document_name;
    delete exp.document_url;
    if (!exp.attachment && exp.documentUrl) {
      exp.attachment = exp.documentUrl;
    }

    return sendSuccess(res, exp, 'Expense created successfully', 201);
  } catch (error) {
    console.error('Error creating expense:', error);
    return sendError(res, error.message, 500);
  }
};

// ── DELETE /:id/expenses/:expenseId ───────────────────────────────────────────
const deleteExpense = async (req, res) => {
  try {
    const { id, expenseId } = req.params;
    const ticket = await db.prepare("SELECT * FROM split_tickets WHERE id = ?").get(id);
    if (!ticket) return sendError(res, 'Split ticket not found', 404, 'NOT_FOUND');

    const exp = await db.prepare("SELECT * FROM split_ticket_expenses WHERE id = ? AND split_ticket_id = ?").get(expenseId, id);
    if (!exp) return sendError(res, 'Expense not found', 404, 'NOT_FOUND');

    // Access control: ticket owner OR expense creator who is editor
    const isOwner = ticket.user_id == req.user.id;
    const isCreator = exp.user_id == req.user.id;

    if (!isOwner && !isCreator) {
      return sendError(res, 'You do not have permission to delete this expense', 403, 'FORBIDDEN');
    }

    await db.prepare("DELETE FROM split_ticket_expenses WHERE id = ? AND split_ticket_id = ?").run(expenseId, id);
    return res.status(204).end();
  } catch (error) {
    console.error('Error deleting expense:', error);
    return sendError(res, error.message, 500);
  }
};

// ── PATCH /:id/expenses/:expenseId ───────────────────────────────────────────
const updateExpense = async (req, res) => {
  try {
    const { id, expenseId } = req.params;
    const { title, amount, paidBy, date, attachment, documentName, documentUrl, splitType, shares } = req.body;

    if (!title || amount === undefined) {
      return sendError(res, 'Title and amount are required', 400, 'BAD_REQUEST');
    }

    const ticket = await db.prepare("SELECT * FROM split_tickets WHERE id = ?").get(id);
    if (!ticket) return sendError(res, 'Split ticket not found', 404, 'NOT_FOUND');

    const existingExp = await db.prepare("SELECT * FROM split_ticket_expenses WHERE id = ? AND split_ticket_id = ?").get(expenseId, id);
    if (!existingExp) return sendError(res, 'Expense not found', 404, 'NOT_FOUND');

    // Access control
    const isOwner = ticket.user_id == req.user.id;
    const isCreator = existingExp.user_id == req.user.id;
    if (!isOwner && !isCreator) {
      let participants = [];
      try { participants = JSON.parse(ticket.participants || '[]'); } catch (e) {}
      const userEmail = (req.user?.email || '').toLowerCase();
      const member = participants.find(p => {
        const pEmail = (typeof p === 'string' ? (p.match(/\(([^)]+@bnxmail\.com)\)/i)?.[1] || (p.includes('@') ? p : '')) : (p.email || '')).toLowerCase();
        return pEmail && pEmail === userEmail;
      });
      const role = typeof member === 'object' ? (member.role || 'viewer') : 'editor';
      const status = typeof member === 'object' ? (member.status || 'pending') : 'accepted';
      if (status !== 'accepted' || role === 'viewer') {
        return sendError(res, 'You do not have permission to edit expenses', 403, 'FORBIDDEN');
      }
    }

    const now = new Date().toISOString();
    const finalDocUrl = documentUrl || (attachment ? (attachment.startsWith('/') ? attachment : `/uploads/${attachment}`) : null);
    const finalDocName = documentName || (attachment ? path.basename(attachment).replace(/^\d+_/, '') : null);

    await db.prepare(`
      UPDATE split_ticket_expenses 
      SET title = ?, amount = ?, paid_by = ?, date = ?, attachment = ?, document_name = ?, document_url = ?, split_type = ?, shares = ?, updated_at = ?
      WHERE id = ? AND split_ticket_id = ?
    `).run(
      title, 
      parseFloat(amount), 
      paidBy, 
      date || now.split('T')[0], 
      finalDocUrl || attachment || null, 
      finalDocName || null, 
      finalDocUrl || null, 
      splitType || 'equal', 
      JSON.stringify(shares || {}), 
      now, 
      expenseId, 
      id
    );

    const exp = await db.prepare("SELECT * FROM split_ticket_expenses WHERE id = ? AND split_ticket_id = ?").get(expenseId, id);
    exp.shares = JSON.parse(exp.shares || '{}');
    exp.paidBy = exp.paid_by;
    delete exp.paid_by;
    exp.splitType = exp.split_type;
    delete exp.split_type;
    exp.amount = parseFloat(exp.amount) || 0;
    exp.documentName = exp.document_name || finalDocName || '';
    exp.documentUrl = exp.document_url || finalDocUrl || exp.attachment || '';
    delete exp.document_name;
    delete exp.document_url;
    if (!exp.attachment && exp.documentUrl) {
      exp.attachment = exp.documentUrl;
    }

    return sendSuccess(res, exp, 'Expense updated successfully');
  } catch (error) {
    console.error('Error updating expense:', error);
    return sendError(res, error.message, 500);
  }
};

// ── PATCH /:id/respond-invite ─────────────────────────────────────────────────
const respondInvite = async (req, res) => {
  try {
    const ticketId = req.params.id;
    const { status, email } = req.body; // status: 'accepted' | 'rejected'
    const targetEmail = (email || req.user?.email || '').toLowerCase();

    if (!['accepted', 'rejected'].includes(status)) {
      return sendError(res, "Status must be 'accepted' or 'rejected'", 400, 'BAD_REQUEST');
    }

    const ticket = await db.prepare("SELECT * FROM split_tickets WHERE id = ?").get(ticketId);
    if (!ticket) return sendError(res, 'Split ticket not found', 404, 'NOT_FOUND');

    let participants = [];
    try { participants = JSON.parse(ticket.participants || '[]'); } catch (e) {}

    let found = false;
    participants = participants.map(p => {
      const pEmail = (typeof p === 'string' ? (p.match(/\(([^)]+@bnxmail\.com)\)/i)?.[1] || (p.includes('@') ? p : '')) : (p.email || '')).toLowerCase();
      if (pEmail === targetEmail) {
        found = true;
        if (typeof p === 'string') {
          return { name: p.replace(/\s*\([^)]+\)/, '').trim(), email: pEmail, role: 'viewer', status, isAdmin: false };
        }
        return { ...p, status };
      }
      return p;
    });

    if (status === 'rejected') {
      participants = participants.filter(p => {
        const pEmail = (typeof p === 'string' ? (p.match(/\(([^)]+@bnxmail\.com)\)/i)?.[1] || (p.includes('@') ? p : '')) : (p.email || '')).toLowerCase();
        return pEmail !== targetEmail;
      });
    }

    const now = new Date().toISOString();
    await db.prepare("UPDATE split_tickets SET participants = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(participants), now, ticketId);

    const updated = await db.prepare("SELECT * FROM split_tickets WHERE id = ?").get(ticketId);
    updated.participants = JSON.parse(updated.participants || '[]');
    updated.currencySymbol = updated.currency_symbol;
    delete updated.currency_symbol;

    return sendSuccess(res, updated, `Invitation ${status} successfully`);
  } catch (error) {
    console.error('Error responding to invite:', error);
    return sendError(res, error.message, 500);
  }
};

// ── PATCH /:id/member-role ───────────────────────────────────────────────────
const updateMemberRole = async (req, res) => {
  try {
    const ticketId = req.params.id;
    const { email, role, isAdmin } = req.body;
    if (!email) {
      return sendError(res, 'Email is required', 400, 'BAD_REQUEST');
    }
    const requestedRole = role ? role.toLowerCase() : (isAdmin ? 'admin' : undefined);
    if (requestedRole && !['viewer', 'editor', 'admin'].includes(requestedRole)) {
      return sendError(res, "Role must be 'viewer', 'editor', or 'admin'", 400, 'BAD_REQUEST');
    }

    const ticket = await db.prepare("SELECT * FROM split_tickets WHERE id = ?").get(ticketId);
    if (!ticket) return sendError(res, 'Split ticket not found', 404, 'NOT_FOUND');

    let participants = [];
    try { participants = JSON.parse(ticket.participants || '[]'); } catch (e) {}

    // Requester must be the split creator OR an admin member
    const isCreator = ticket.user_id == req.user.id;
    const userEmail = (req.user?.email || '').toLowerCase();
    const isParticipantAdmin = participants.some(p => {
      const pEmail = (typeof p === 'string' ? (p.match(/\(([^)]+@bnxmail\.com)\)/i)?.[1] || (p.includes('@') ? p : '')) : (p.email || '')).toLowerCase();
      return pEmail && pEmail === userEmail && (p.isAdmin || p.role === 'admin');
    });

    if (!isCreator && !isParticipantAdmin) {
      return sendError(res, 'Only the split ticket admin can modify member permissions', 403, 'FORBIDDEN');
    }

    participants = participants.map(p => {
      const pEmail = (typeof p === 'string' ? (p.match(/\(([^)]+@bnxmail\.com)\)/i)?.[1] || (p.includes('@') ? p : '')) : (p.email || '')).toLowerCase();
      if (pEmail === email.toLowerCase()) {
        const makeAdmin = requestedRole === 'admin' || isAdmin === true;
        const targetRole = requestedRole === 'admin' ? 'admin' : (requestedRole || (p.role || 'viewer'));
        const targetIsAdmin = makeAdmin ? true : (isAdmin === false ? false : (requestedRole === 'admin' ? true : !!p.isAdmin));

        if (typeof p === 'string') {
          return {
            name: p.replace(/\s*\([^)]+\)/, '').trim(),
            email: pEmail,
            role: targetRole,
            status: 'accepted',
            isAdmin: targetIsAdmin
          };
        }
        return {
          ...p,
          role: targetRole,
          isAdmin: targetIsAdmin
        };
      }
      return p;
    });

    const now = new Date().toISOString();
    await db.prepare("UPDATE split_tickets SET participants = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(participants), now, ticketId);

    const updated = await db.prepare("SELECT * FROM split_tickets WHERE id = ?").get(ticketId);
    updated.participants = JSON.parse(updated.participants || '[]');
    updated.currencySymbol = updated.currency_symbol;
    delete updated.currency_symbol;

    return sendSuccess(res, updated, `Member permissions updated successfully`);
  } catch (error) {
    console.error('Error updating member role:', error);
    return sendError(res, error.message, 500);
  }
};

// ── POST /:id/invite ──────────────────────────────────────────────────────────
const inviteMember = async (req, res) => {
  try {
    const ticketId = req.params.id;
    const { name, email, role = 'viewer', isAdmin = false } = req.body;
    if (!email) return sendError(res, 'Email is required', 400, 'BAD_REQUEST');

    if (!BNX_EMAIL_REGEX.test(email.trim())) {
      return sendError(res, 'Only official @bnxmail.com domain emails are allowed', 400, 'INVALID_BNXMAIL');
    }

    const ticket = await db.prepare("SELECT * FROM split_tickets WHERE id = ?").get(ticketId);
    if (!ticket) return sendError(res, 'Split ticket not found', 404, 'NOT_FOUND');

    let participants = [];
    try { participants = JSON.parse(ticket.participants || '[]'); } catch (e) {}

    const isCreator = ticket.user_id == req.user.id;
    const userEmail = (req.user?.email || '').toLowerCase();
    const isParticipantAdmin = participants.some(p => {
      const pEmail = (typeof p === 'string' ? (p.match(/\(([^)]+@bnxmail\.com)\)/i)?.[1] || (p.includes('@') ? p : '')) : (p.email || '')).toLowerCase();
      return pEmail && pEmail === userEmail && (p.isAdmin || p.role === 'admin');
    });

    if (!isCreator && !isParticipantAdmin) {
      return sendError(res, 'Only the split ticket admin can invite members', 403, 'FORBIDDEN');
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = (name && name.trim()) || cleanEmail.split('@')[0];

    const exists = participants.some(p => {
      const pEmail = (typeof p === 'string' ? (p.match(/\(([^)]+@bnxmail\.com)\)/i)?.[1] || (p.includes('@') ? p : '')) : (p.email || '')).toLowerCase();
      return pEmail === cleanEmail;
    });

    if (exists) {
      return sendError(res, 'This member is already added to this split', 400, 'ALREADY_EXISTS');
    }

    const isMemberAdmin = role === 'admin' || isAdmin === true;
    const newMember = {
      name: cleanName,
      email: cleanEmail,
      role: isMemberAdmin ? 'admin' : (role === 'editor' ? 'editor' : 'viewer'),
      status: 'pending',
      isAdmin: isMemberAdmin,
      invitedAt: new Date().toISOString()
    };

    participants.push(newMember);

    const now = new Date().toISOString();
    await db.prepare("UPDATE split_tickets SET participants = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(participants), now, ticketId);

    const updated = await db.prepare("SELECT * FROM split_tickets WHERE id = ?").get(ticketId);
    updated.participants = JSON.parse(updated.participants || '[]');
    updated.currencySymbol = updated.currency_symbol;
    delete updated.currency_symbol;

    return sendSuccess(res, updated, `Invitation sent to ${cleanEmail}`, 201);
  } catch (error) {
    console.error('Error inviting member:', error);
    return sendError(res, error.message, 500);
  }
};

// ── PATCH /:id ────────────────────────────────────────────────────────────────
const updateSplitExpense = async (req, res) => {
  try {
    const ticketId = req.params.id;
    const { title, currency, currencySymbol, description, participants } = req.body;
    
    if (!title) {
      return sendError(res, 'Title is required', 400, 'BAD_REQUEST');
    }

    const ticket = await db.prepare("SELECT * FROM split_tickets WHERE id = ?").get(ticketId);
    if (!ticket) {
      return sendError(res, 'Split ticket not found', 404, 'NOT_FOUND');
    }

    if (ticket.user_id != req.user.id) {
      return sendError(res, 'Only the split ticket admin can update this ticket', 403, 'FORBIDDEN');
    }

    if (participants && Array.isArray(participants)) {
      for (const p of participants) {
        const email = typeof p === 'string' 
          ? (p.match(/\(([^)]+@bnxmail\.com)\)/i)?.[1] || (p.includes('@') ? p : '')) 
          : (p.email || '');
        if (email && !BNX_EMAIL_REGEX.test(email.trim())) {
          return sendError(res, `Invalid email '${email}'. Only official @bnxmail.com domain emails are allowed.`, 400, 'INVALID_BNXMAIL');
        }
      }
    }

    const now = new Date().toISOString();

    await db.prepare(`
      UPDATE split_tickets 
      SET title = ?, currency = ?, currency_symbol = ?, description = ?, participants = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(
      title, 
      currency || 'INR', 
      currencySymbol || '₹', 
      description || '', 
      JSON.stringify(participants || []), 
      now, 
      ticketId, 
      req.user.id
    );

    const updatedTicket = await db.prepare("SELECT * FROM split_tickets WHERE id = ?").get(ticketId);
    updatedTicket.participants = JSON.parse(updatedTicket.participants || '[]');
    updatedTicket.currencySymbol = updatedTicket.currency_symbol;
    delete updatedTicket.currency_symbol;

    return sendSuccess(res, updatedTicket, 'Split ticket updated successfully');
  } catch (error) {
    console.error('Error updating split ticket:', error);
    return sendError(res, error.message, 500);
  }
};

const uploadAttachment = async (req, res) => {
  try {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    if (req.is('multipart/form-data')) {
      const formidable = require('formidable');
      const form = formidable({
        uploadDir,
        keepExtensions: true,
        maxFileSize: 25 * 1024 * 1024
      });

      return form.parse(req, (err, fields, files) => {
        if (err) {
          console.error('Multipart upload error:', err);
          return sendError(res, 'File upload failed: ' + err.message, 500);
        }

        const fileObj = files.file || files.attachment || Object.values(files)[0];
        const uploadedFile = Array.isArray(fileObj) ? fileObj[0] : fileObj;

        if (!uploadedFile) {
          return sendError(res, 'No file uploaded', 400, 'BAD_REQUEST');
        }

        const origName = uploadedFile.originalFilename || uploadedFile.newFilename || 'attachment';
        const safeFilename = Date.now() + '_' + path.basename(origName).replace(/[^a-zA-Z0-9.-]/g, '_');
        const targetPath = path.join(uploadDir, safeFilename);

        try {
          fs.renameSync(uploadedFile.filepath, targetPath);
        } catch {
          fs.copyFileSync(uploadedFile.filepath, targetPath);
          try { fs.unlinkSync(uploadedFile.filepath); } catch (_) {}
        }

        return sendSuccess(res, { filename: safeFilename, url: `/uploads/${safeFilename}` }, 'File uploaded successfully');
      });
    }

    const { name, content } = req.body;
    if (!name || !content) {
      return sendError(res, 'Filename and content are required', 400, 'BAD_REQUEST');
    }

    const safeFilename = Date.now() + '_' + path.basename(name).replace(/[^a-zA-Z0-9.-]/g, '_');
    const filePath = path.join(uploadDir, safeFilename);
    const fileBuffer = Buffer.from(content, 'base64');
    fs.writeFileSync(filePath, fileBuffer);

    return sendSuccess(res, { filename: safeFilename, url: `/uploads/${safeFilename}` }, 'File uploaded successfully');
  } catch (error) {
    console.error('Upload error:', error);
    return sendError(res, 'File upload failed: ' + error.message, 500);
  }
};

// ── DUMMY FALLBACK EXPORTS FOR COMPATIBILITY ──────────────────────────────────
const getSplitSummary = async (req, res) => sendSuccess(res, []);
const settleFriend = async (req, res) => sendSuccess(res, {});
const getSplitExpense = async (req, res) => sendSuccess(res, {});
const getParticipants = async (req, res) => sendSuccess(res, []);
const addParticipant = async (req, res) => sendSuccess(res, {}, 201);
const settleParticipant = async (req, res) => sendSuccess(res, {});

const deleteParticipant = async (req, res) => {
  try {
    const { id, participantId } = req.params;
    const ticket = await db.prepare("SELECT * FROM split_tickets WHERE id = ?").get(id);
    if (!ticket) return sendError(res, 'Split ticket not found', 404, 'NOT_FOUND');

    if (ticket.user_id != req.user.id) {
      return sendError(res, 'Only the split ticket admin can remove members', 403, 'FORBIDDEN');
    }

    let participants = [];
    try { participants = JSON.parse(ticket.participants || '[]'); } catch (e) {}

    const target = decodeURIComponent(participantId).toLowerCase();
    participants = participants.filter(p => {
      const pEmail = (typeof p === 'string' ? (p.match(/\(([^)]+@bnxmail\.com)\)/i)?.[1] || (p.includes('@') ? p : '')) : (p.email || '')).toLowerCase();
      const pName = (typeof p === 'string' ? p : (p.name || '')).toLowerCase();
      return pEmail !== target && pName !== target;
    });

    const now = new Date().toISOString();
    await db.prepare("UPDATE split_tickets SET participants = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(participants), now, id);

    return res.status(204).end();
  } catch (error) {
    console.error('Error removing participant:', error);
    return sendError(res, error.message, 500);
  }
};

module.exports = {
  getSplitExpenses,
  createSplitExpense,
  deleteSplitExpense,
  createExpense,
  deleteExpense,
  updateExpense,
  uploadAttachment,
  getSplitSummary,
  settleFriend,
  getSplitExpense,
  updateSplitExpense,
  getParticipants,
  addParticipant,
  settleParticipant,
  deleteParticipant,
  respondInvite,
  updateMemberRole,
  inviteMember
};
