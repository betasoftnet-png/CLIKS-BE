const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { paginate } = require('../utils/pagination');

// ── GET /summary ─────────────────────────────────────────────────────────────
const getSplitSummary = async (req, res) => {
  try {
    const participants = await db.prepare(`
      SELECT 
        name,
        SUM(CASE WHEN is_settled = 0 THEN share_amount ELSE 0 END) as total_owed,
        COUNT(*) as split_count
      FROM split_participants
      WHERE user_id = ?
      GROUP BY name
    `).all(req.user.id);

    return sendSuccess(res, participants, 'Split summary fetched');
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

// ── PATCH /settle-friend ─────────────────────────────────────────────────────
const settleFriend = async (req, res) => {
  const { name } = req.body;
  if (!name) return sendError(res, 'name is required', 400, 'BAD_REQUEST');

  await db.prepare(`
    UPDATE split_participants 
    SET is_settled = 1, updated_at = ? 
    WHERE user_id = ? AND name = ? AND is_settled = 0
  `).run(new Date().toISOString(), req.user.id, name);

  return sendSuccess(res, { name }, 'Friend settled');
};

// ── GET / ─────────────────────────────────────────────────────────────────────
const getSplitExpenses = async (req, res) => {
  try {
    const { page, limit, sort = 'created_at', order = 'desc', search, from, to } = req.query;
    
    // Base query with participant count and names joined as a string
    let query = `
      SELECT 
        se.*,
        (SELECT COUNT(*) FROM split_participants WHERE split_expense_id = se.id) as participant_count,
        (SELECT ${process.env.DB_TYPE === 'postgres' ? "string_agg(name, ', ')" : "GROUP_CONCAT(name, ', ')"} FROM split_participants WHERE split_expense_id = se.id) as participant_names
      FROM split_expenses se
      WHERE se.user_id = ?
    `;
    const params = [req.user.id];

    if (search) { query += ' AND se.title LIKE ?'; params.push(`%${search}%`); }
    if (from)   { query += ' AND se.date >= ?'; params.push(from); }
    if (to)     { query += ' AND se.date <= ?'; params.push(to); }

    const allowedSorts = ['created_at', 'updated_at', 'title', 'total_amount', 'date'];
    const sortCol = allowedSorts.includes(sort) ? sort : 'created_at';
    const sortDir = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    query += ` ORDER BY se.${sortCol} ${sortDir}`;

    const result = await paginate(query, params, page, limit, db);
    return sendSuccess(res, result.rows, 'Split expenses fetched', 200, result.meta);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

// ── POST / ────────────────────────────────────────────────────────────────────
const createSplitExpense = async (req, res) => {
  try {
    const { title, total_amount, date, notes, split_type, paid_by, participants = [] } = req.body;
    if (!title || total_amount === undefined || !date) {
      return sendError(res, 'title, total_amount, and date are required', 400, 'BAD_REQUEST');
    }

    if (participants.length > 0) {
      const sum = participants.reduce((acc, p) => acc + (parseFloat(p.share_amount) || 0), 0);
      if (sum > parseFloat(total_amount) + 0.01) {
        return sendError(
          res,
          `Participant shares (${sum.toFixed(2)}) cannot exceed total_amount (${parseFloat(total_amount).toFixed(2)})`,
          400,
          'VALIDATION_ERROR'
        );
      }
    }

    const now = new Date().toISOString();
    const create = db.transaction(async () => {
      const stmt = db.prepare(`
        INSERT INTO split_expenses (user_id, title, total_amount, date, split_type, paid_by, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const info = await stmt.run(req.user.id, title, total_amount, date, split_type || 'equal', paid_by || 'You', notes || null, now, now);
      const splitId = info.lastInsertRowid;

      if (participants.length > 0) {
        const pStmt = db.prepare(`
          INSERT INTO split_participants (split_expense_id, user_id, name, share_amount, is_settled, created_at, updated_at)
          VALUES (?, ?, ?, ?, 0, ?, ?)
        `);
        for (const p of participants) {
          await pStmt.run(splitId, req.user.id, p.name, p.share_amount, now, now);
        }
      }

      return splitId;
    });

    const splitId = await create();
    const newSplit = await db.prepare('SELECT * FROM split_expenses WHERE id = ?').get(splitId);
    newSplit.participants = await db.prepare('SELECT * FROM split_participants WHERE split_expense_id = ?').all(splitId);

    return sendSuccess(res, newSplit, 'Split expense created', 201);
  } catch (error) {
    console.error('[SplitExpenseController] Error:', error);
    return sendError(res, error.message, 500);
  }
};

// ── GET /:id ──────────────────────────────────────────────────────────────────
const getSplitExpense = async (req, res) => {
  const split = await db.prepare('SELECT * FROM split_expenses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!split) return sendError(res, 'Split expense not found', 404, 'NOT_FOUND');

  split.participants = await db.prepare(
    'SELECT * FROM split_participants WHERE split_expense_id = ? AND user_id = ?'
  ).all(req.params.id, req.user.id);

  return sendSuccess(res, split);
};

// ── PATCH /:id ────────────────────────────────────────────────────────────────
const updateSplitExpense = async (req, res) => {
  const split = await db.prepare('SELECT * FROM split_expenses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!split) return sendError(res, 'Split expense not found', 404, 'NOT_FOUND');

  const updates = [];
  const params = [];
  for (const field of ['title', 'total_amount', 'date', 'notes']) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      params.push(req.body[field]);
    }
  }

  if (updates.length > 0) {
    updates.push('updated_at = ?');
    params.push(new Date().toISOString(), req.params.id, req.user.id);
    await db.prepare(`UPDATE split_expenses SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
  }

  const updated = await db.prepare('SELECT * FROM split_expenses WHERE id = ?').get(req.params.id);
  updated.participants = await db.prepare('SELECT * FROM split_participants WHERE split_expense_id = ?').all(req.params.id);
  return sendSuccess(res, updated, 'Split expense updated');
};

// ── DELETE /:id ───────────────────────────────────────────────────────────────
const deleteSplitExpense = async (req, res) => {
  const split = await db.prepare('SELECT * FROM split_expenses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!split) return sendError(res, 'Split expense not found', 404, 'NOT_FOUND');

  await db.transaction(async () => {
    await db.prepare('DELETE FROM split_participants WHERE split_expense_id = ? AND user_id = ?').run(req.params.id, req.user.id);
    await db.prepare('DELETE FROM split_expenses WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  })();

  return res.status(204).end();
};

// ── GET /:id/participants ─────────────────────────────────────────────────────
const getParticipants = async (req, res) => {
  const split = await db.prepare('SELECT * FROM split_expenses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!split) return sendError(res, 'Split expense not found', 404, 'NOT_FOUND');

  const participants = await db.prepare(
    'SELECT * FROM split_participants WHERE split_expense_id = ? AND user_id = ? ORDER BY created_at ASC'
  ).all(req.params.id, req.user.id);

  return sendSuccess(res, participants, 'Participants fetched');
};

// ── POST /:id/participants ────────────────────────────────────────────────────
const addParticipant = async (req, res) => {
  const split = await db.prepare('SELECT * FROM split_expenses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!split) return sendError(res, 'Split expense not found', 404, 'NOT_FOUND');

  const { name, share_amount } = req.body;
  if (!name || share_amount === undefined) {
    return sendError(res, 'name and share_amount are required', 400, 'BAD_REQUEST');
  }

  const now = new Date().toISOString();
  const info = await db.prepare(`
    INSERT INTO split_participants (split_expense_id, user_id, name, share_amount, is_settled, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, ?, ?)
  `).run(req.params.id, req.user.id, name, share_amount, now, now);

  const newParticipant = await db.prepare('SELECT * FROM split_participants WHERE id = ?').get(info.lastInsertRowid);
  return sendSuccess(res, newParticipant, 'Participant added', 201);
};

// ── PATCH /:id/participants/:participantId/settle ─────────────────────────────
const settleParticipant = async (req, res) => {
  const split = await db.prepare('SELECT * FROM split_expenses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!split) return sendError(res, 'Split expense not found', 404, 'NOT_FOUND');

  const participant = await db.prepare(
    'SELECT * FROM split_participants WHERE id = ? AND split_expense_id = ? AND user_id = ?'
  ).get(req.params.participantId, req.params.id, req.user.id);
  if (!participant) return sendError(res, 'Participant not found', 404, 'NOT_FOUND');

  await db.prepare(
    'UPDATE split_participants SET is_settled = 1, updated_at = ? WHERE id = ?'
  ).run(new Date().toISOString(), req.params.participantId);

  const updated = await db.prepare('SELECT * FROM split_participants WHERE id = ?').get(req.params.participantId);
  return sendSuccess(res, updated, 'Participant settled');
};

// ── DELETE /:id/participants/:participantId ────────────────────────────────────
const deleteParticipant = async (req, res) => {
  const split = await db.prepare('SELECT * FROM split_expenses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!split) return sendError(res, 'Split expense not found', 404, 'NOT_FOUND');

  const participant = await db.prepare(
    'SELECT * FROM split_participants WHERE id = ? AND split_expense_id = ? AND user_id = ?'
  ).get(req.params.participantId, req.params.id, req.user.id);
  if (!participant) return sendError(res, 'Participant not found', 404, 'NOT_FOUND');

  await db.prepare('DELETE FROM split_participants WHERE id = ?').run(req.params.participantId);
  return res.status(204).end();
};

module.exports = { getSplitSummary, settleFriend, getSplitExpenses, createSplitExpense, getSplitExpense, updateSplitExpense, deleteSplitExpense, getParticipants, addParticipant, settleParticipant, deleteParticipant };
