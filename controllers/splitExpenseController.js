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
    const { id, title, amount, paidBy, date, attachment, splitType, shares } = req.body;
    const splitTicketId = req.params.id;

    if (!title || amount === undefined) {
      return sendError(res, 'Title and amount are required', 400, 'BAD_REQUEST');
    }

    const expId = id || 'exp-' + Date.now();
    const now = new Date().toISOString();

    await db.prepare(`
      INSERT INTO split_ticket_expenses (id, split_ticket_id, user_id, title, amount, paid_by, date, attachment, split_type, shares, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(expId, splitTicketId, req.user.id, title, parseFloat(amount), paidBy, date || now.split('T')[0], attachment || null, splitType || 'equal', JSON.stringify(shares || {}), now, now);

    const exp = await db.prepare("SELECT * FROM split_ticket_expenses WHERE id = ?").get(expId);
    exp.shares = JSON.parse(exp.shares);
    exp.paidBy = exp.paid_by;
    delete exp.paid_by;
    exp.splitType = exp.split_type;
    delete exp.split_type;

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
  getSplitSummary,
  settleFriend,
  getSplitExpense,
  updateSplitExpense,
  getParticipants,
  addParticipant,
  settleParticipant,
  deleteParticipant
};
