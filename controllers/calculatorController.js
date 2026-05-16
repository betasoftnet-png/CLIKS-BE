const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

const getHistory = async (req, res) => {
  try {
    const history = await db.prepare('SELECT * FROM calculator_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 30').all(req.user.id);
    // Parse tape JSON string back to object
    const parsedHistory = history.map(item => ({
      ...item,
      tape: JSON.parse(item.tape)
    }));
    return sendSuccess(res, parsedHistory, 'Calculator history retrieved');
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

const saveHistory = async (req, res) => {
  const { tape, total, timestamp } = req.body;
  if (!tape || total === undefined) {
    return sendError(res, 'Tape and total are required', 400);
  }

  try {
    const now = new Date().toISOString();
    const tapeString = JSON.stringify(tape);
    const result = await db.prepare(
      'INSERT INTO calculator_history (user_id, tape, total, timestamp, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(req.user.id, tapeString, total, timestamp || now, now);

    const newItem = {
      id: result.lastInsertRowid,
      user_id: req.user.id,
      tape,
      total,
      timestamp: timestamp || now,
      created_at: now
    };

    return sendSuccess(res, newItem, 'Calculation saved to history', 201);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

const deleteHistoryItem = async (req, res) => {
  const { id } = req.params;
  try {
    await db.prepare('DELETE FROM calculator_history WHERE id = ? AND user_id = ?').run(id, req.user.id);
    return sendSuccess(res, null, 'Calculation deleted from history');
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

const clearHistory = async (req, res) => {
  try {
    await db.prepare('DELETE FROM calculator_history WHERE user_id = ?').run(req.user.id);
    return sendSuccess(res, null, 'Calculator history cleared');
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

module.exports = {
  getHistory,
  saveHistory,
  deleteHistoryItem,
  clearHistory
};
