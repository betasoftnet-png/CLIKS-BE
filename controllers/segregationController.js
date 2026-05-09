const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { paginate } = require('../utils/pagination');

const getSegregations = async (req, res) => {
  const { page, limit, sort = 'created_at', order = 'desc', search, rule_type } = req.query;
  let query = 'SELECT * FROM segregation WHERE user_id = ?';
  const params = [req.user.id];

  if (rule_type) { query += ' AND rule_type = ?'; params.push(rule_type); }
  if (search) { query += ' AND (name LIKE ? OR description LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

  const allowedSorts = ['created_at', 'updated_at', 'name', 'rule_type'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'created_at';
  const sortDir = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  query += ` ORDER BY ${sortCol} ${sortDir}`;

  const result = await paginate(query, params, page, limit, db);
  return sendSuccess(res, result.rows, 'Segregation rules fetched', 200, result.meta);
};

const createSegregation = async (req, res) => {
  const { name, rule_type, description, allocations } = req.body;
  if (!name || !rule_type) return sendError(res, 'Name and rule_type are required', 400, 'BAD_REQUEST');

  if (allocations && Array.isArray(allocations)) {
    const totalPct = allocations.reduce((sum, a) => sum + (parseFloat(a.percentage) || 0), 0);
    if (Math.abs(totalPct - 100) > 0.01) {
      return sendError(res, `Allocations must sum to 100%. Currently: ${totalPct.toFixed(2)}%`, 400, 'VALIDATION_ERROR');
    }
  }

  const now = new Date().toISOString();
  const createRule = db.transaction(async () => {
    const stmt = db.prepare(`
      INSERT INTO segregation (user_id, name, rule_type, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const info = await stmt.run(req.user.id, name, rule_type, description || null, now, now);
    const ruleId = info.lastInsertRowid;

    if (allocations && Array.isArray(allocations)) {
      const allocStmt = db.prepare(`
        INSERT INTO segregation_allocations (rule_id, user_id, label, percentage, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const alloc of allocations) {
        await allocStmt.run(ruleId, req.user.id, alloc.label, alloc.percentage, alloc.notes || null, now, now);
      }
    }

    return ruleId;
  });

  const ruleId = await createRule();
  const newRule = await db.prepare('SELECT * FROM segregation WHERE id = ?').get(ruleId);
  const ruleAllocations = await db.prepare('SELECT * FROM segregation_allocations WHERE rule_id = ?').all(ruleId);
  newRule.allocations = ruleAllocations;

  return sendSuccess(res, newRule, 'Segregation rule created', 201);
};

const getSegregation = async (req, res) => {
  const rule = await db.prepare('SELECT * FROM segregation WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!rule) return sendError(res, 'Segregation rule not found', 404, 'NOT_FOUND');

  const allocations = await db.prepare('SELECT * FROM segregation_allocations WHERE rule_id = ? AND user_id = ?').all(req.params.id, req.user.id);
  rule.allocations = allocations;
  return sendSuccess(res, rule);
};

const updateSegregation = async (req, res) => {
  const rule = await db.prepare('SELECT * FROM segregation WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!rule) return sendError(res, 'Segregation rule not found', 404, 'NOT_FOUND');

  const { allocations } = req.body;

  if (allocations && Array.isArray(allocations)) {
    const totalPct = allocations.reduce((sum, a) => sum + (parseFloat(a.percentage) || 0), 0);
    if (Math.abs(totalPct - 100) > 0.01) {
      return sendError(res, `Allocations must sum to 100%. Currently: ${totalPct.toFixed(2)}%`, 400, 'VALIDATION_ERROR');
    }
  }

  const now = new Date().toISOString();
  const updateRule = db.transaction(async () => {
    const updates = [];
    const params = [];
    for (const field of ['name', 'rule_type', 'description']) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        params.push(req.body[field]);
      }
    }
    if (updates.length > 0) {
      updates.push('updated_at = ?');
      params.push(now, req.params.id, req.user.id);
      await db.prepare(`UPDATE segregation SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
    }

    if (allocations && Array.isArray(allocations)) {
      await db.prepare('DELETE FROM segregation_allocations WHERE rule_id = ? AND user_id = ?').run(req.params.id, req.user.id);
      const allocStmt = db.prepare(`
        INSERT INTO segregation_allocations (rule_id, user_id, label, percentage, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const alloc of allocations) {
        await allocStmt.run(req.params.id, req.user.id, alloc.label, alloc.percentage, alloc.notes || null, now, now);
      }
    }
  });

  await updateRule();
  const updatedRule = await db.prepare('SELECT * FROM segregation WHERE id = ?').get(req.params.id);
  updatedRule.allocations = await db.prepare('SELECT * FROM segregation_allocations WHERE rule_id = ?').all(req.params.id);
  return sendSuccess(res, updatedRule, 'Segregation rule updated');
};

const deleteSegregation = async (req, res) => {
  const rule = await db.prepare('SELECT * FROM segregation WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!rule) return sendError(res, 'Segregation rule not found', 404, 'NOT_FOUND');

  const deleteRule = db.transaction(async () => {
    await db.prepare('DELETE FROM segregation_allocations WHERE rule_id = ? AND user_id = ?').run(req.params.id, req.user.id);
    await db.prepare('DELETE FROM segregation WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  });
  await deleteRule();
  return res.status(204).end();
};

module.exports = { getSegregations, createSegregation, getSegregation, updateSegregation, deleteSegregation };
