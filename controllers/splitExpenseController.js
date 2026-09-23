const path = require('path');
const fs = require('fs');
const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

// ── GET / ─────────────────────────────────────────────────────────────────────
const getSplitExpenses = async (req, res) => {
  try {
    const tickets = await db.prepare("SELECT * FROM split_tickets WHERE user_id = ? ORDER BY created_at DESC").all(req.user.id);
    for (const ticket of tickets) {
      try {
        ticket.participants = JSON.parse(ticket.participants || '[]');
      } catch (e) {
        ticket.participants = [];
      }
      ticket.currencySymbol = ticket.currency_symbol;
      delete ticket.currency_symbol;

      const expenses = await db.prepare("SELECT * FROM split_ticket_expenses WHERE split_ticket_id = ? AND user_id = ? ORDER BY created_at DESC").all(ticket.id, req.user.id);
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
        // Keep attachment synced for backward compatibility
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

    const ticketId = id || 'split-' + Date.now();
    const now = new Date().toISOString();

    await db.prepare(`
      INSERT INTO split_tickets (id, user_id, title, currency, currency_symbol, description, participants, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(ticketId, req.user.id, title, currency || 'INR', currencySymbol || '₹', description || '', JSON.stringify(participants), now, now);

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
    await db.transaction(async () => {
      await db.prepare("DELETE FROM split_ticket_expenses WHERE split_ticket_id = ? AND user_id = ?").run(ticketId, req.user.id);
      await db.prepare("DELETE FROM split_tickets WHERE id = ? AND user_id = ?").run(ticketId, req.user.id);
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
    await db.prepare("DELETE FROM split_ticket_expenses WHERE id = ? AND split_ticket_id = ? AND user_id = ?").run(expenseId, id, req.user.id);
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

    const now = new Date().toISOString();
    const finalDocUrl = documentUrl || (attachment ? (attachment.startsWith('/') ? attachment : `/uploads/${attachment}`) : null);
    const finalDocName = documentName || (attachment ? path.basename(attachment).replace(/^\d+_/, '') : null);

    await db.prepare(`
      UPDATE split_ticket_expenses 
      SET title = ?, amount = ?, paid_by = ?, date = ?, attachment = ?, document_name = ?, document_url = ?, split_type = ?, shares = ?, updated_at = ?
      WHERE id = ? AND split_ticket_id = ? AND user_id = ?
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
      id, 
      req.user.id
    );

    const exp = await db.prepare("SELECT * FROM split_ticket_expenses WHERE id = ? AND split_ticket_id = ? AND user_id = ?").get(expenseId, id, req.user.id);
    if (!exp) {
      return sendError(res, 'Expense not found', 404, 'NOT_FOUND');
    }

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

// ── DUMMY FALLBACK EXPORTS FOR OLD SYSTEM COMPATIBILITY ───────────────────────
const getSplitSummary = async (req, res) => sendSuccess(res, []);
const settleFriend = async (req, res) => sendSuccess(res, {});
const getSplitExpense = async (req, res) => sendSuccess(res, {});

// ── PATCH /:id ────────────────────────────────────────────────────────────────
const updateSplitExpense = async (req, res) => {
  try {
    const ticketId = req.params.id;
    const { title, currency, currencySymbol, description, participants } = req.body;
    
    if (!title) {
      return sendError(res, 'Title is required', 400, 'BAD_REQUEST');
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

    const ticket = await db.prepare("SELECT * FROM split_tickets WHERE id = ?").get(ticketId);
    if (!ticket) {
      return sendError(res, 'Split ticket not found', 404, 'NOT_FOUND');
    }
    
    ticket.participants = JSON.parse(ticket.participants);
    ticket.currencySymbol = ticket.currency_symbol;
    delete ticket.currency_symbol;
    
    // We don't fetch expenses here as the frontend just needs the updated basic info, 
    // or we can fetch them if needed. Usually frontend merges updated info with existing state.

    return sendSuccess(res, ticket, 'Split ticket updated successfully');
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

const getParticipants = async (req, res) => sendSuccess(res, []);
const addParticipant = async (req, res) => sendSuccess(res, {}, 201);
const settleParticipant = async (req, res) => sendSuccess(res, {});
const deleteParticipant = async (req, res) => res.status(204).end();

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
  deleteParticipant
};

