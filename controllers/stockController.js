const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { paginate } = require('../utils/pagination');

// ── Helper: derive status from quantity ───────────────────────────────────────
function deriveStatus(quantity) {
  if (quantity === 0) return 'Out of Stock';
  if (quantity < 5) return 'Low Stock';
  return 'In Stock';
}

// ── Helper: enrich a stock row with computed fields ──────────────────────────
function enrichRow(row) {
  if (!row) return row;
  return {
    ...row,
    status: deriveStatus(row.quantity || 0),
    value: (row.quantity || 0) * (row.unit_price || 0),
  };
}

// ── GET /stats — Aggregate inventory statistics ────────────────────────────
const getStockStats = async (req, res) => {
  const stats = await db.prepare(`
    SELECT
      COUNT(*)                                                              AS totalItems,
      COALESCE(SUM(quantity * unit_price), 0)                              AS totalValue,
      SUM(CASE WHEN quantity = 0             THEN 1 ELSE 0 END)            AS outOfStockCount,
      SUM(CASE WHEN quantity > 0 AND quantity < 5 THEN 1 ELSE 0 END)      AS lowStockCount,
      SUM(CASE WHEN quantity >= 5            THEN 1 ELSE 0 END)            AS inStockCount
    FROM stock
    WHERE user_id = ?
  `).get(req.user.id);

  const categoryRows = await db.prepare(
    'SELECT DISTINCT category FROM stock WHERE user_id = ? AND category IS NOT NULL ORDER BY category ASC'
  ).all(req.user.id);

  return sendSuccess(res, {
    totalItems:      stats.totalItems     || 0,
    totalValue:      stats.totalValue     || 0,
    lowStockCount:   stats.lowStockCount  || 0,
    outOfStockCount: stats.outOfStockCount|| 0,
    inStockCount:    stats.inStockCount   || 0,
    inUseCount:      (stats.lowStockCount || 0) + (stats.inStockCount || 0),
    categories:      categoryRows.map(r => r.category),
  }, 'Stock stats fetched');
};

// ── GET / ─────────────────────────────────────────────────────────────────────
const getStocks = async (req, res) => {
  const { category, location, status, page, limit, sort = 'created_at', order = 'desc', search } = req.query;
  let query = 'SELECT * FROM stock WHERE user_id = ?';
  const params = [req.user.id];

  if (category) { query += ' AND category LIKE ?'; params.push(`%${category}%`); }
  if (location) { query += ' AND location LIKE ?'; params.push(`%${location}%`); }
  if (search)   { query += ' AND (name LIKE ? OR sku LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

  if (status === 'Out of Stock') { query += ' AND quantity = 0'; }
  else if (status === 'Low Stock') { query += ' AND quantity > 0 AND quantity < 5'; }
  else if (status === 'In Stock')  { query += ' AND quantity >= 5'; }

  const allowedSorts = ['created_at', 'updated_at', 'name', 'quantity', 'unit_price'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'created_at';
  const sortDir = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  query += ` ORDER BY ${sortCol} ${sortDir}`;

  const result = await paginate(query, params, page, limit, db);
  return sendSuccess(res, result.rows.map(enrichRow), 'Stock fetched', 200, result.meta);
};

// ── POST / ────────────────────────────────────────────────────────────────────
const createStock = async (req, res) => {
  const { name, sku, quantity = 0, unit, unit_price, category, location, notes } = req.body;
  if (!name) return sendError(res, 'Name is required', 400, 'BAD_REQUEST');

  const now = new Date().toISOString();
  const qty = Number(quantity || 0);
  const price = Number(unit_price || 0);
  const stmt = db.prepare(`
    INSERT INTO stock (user_id, name, sku, quantity, unit, unit_price, category, location, notes, created_at, updated_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = await stmt.run(req.user.id, name, sku || null, qty, unit || null, price || null, category || null, location || null, notes || null, now, now);
  
  const newItem = await db.prepare('SELECT * FROM stock WHERE id = ?').get(info.lastInsertRowid);
  
  // Log initial stock as a transaction
  await db.prepare(`
    INSERT INTO stock_transactions (stock_id, user_id, type, quantity, date, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(newItem.id, req.user.id, 'in', quantity, now, now);

  return sendSuccess(res, enrichRow(newItem), 'Stock item created', 201);
};

// ── GET /:id ──────────────────────────────────────────────────────────────────
const getStock = async (req, res) => {
  const item = await db.prepare('SELECT * FROM stock WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Stock item not found', 404, 'NOT_FOUND');
  return sendSuccess(res, enrichRow(item));
};

// ── PATCH /:id ────────────────────────────────────────────────────────────────
const updateStock = async (req, res) => {
  const item = await db.prepare('SELECT * FROM stock WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Stock item not found', 404, 'NOT_FOUND');

  const updates = [];
  const params = [];
  const allowedFields = ['name', 'sku', 'quantity', 'unit', 'unit_price', 'category', 'location', 'notes'];
  
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      let val = req.body[field];
      if (field === 'quantity' || field === 'unit_price') val = Number(val);
      params.push(val);
    }
  }

  if (updates.length > 0) {
    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(req.params.id, req.user.id);
    await db.prepare(`UPDATE stock SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
  }
  
  const updatedItem = await db.prepare('SELECT * FROM stock WHERE id = ?').get(req.params.id);
  return sendSuccess(res, enrichRow(updatedItem), 'Stock item updated');
};

// ── PATCH /:id/adjust-quantity ────────────────────────────────────────────────
const adjustQuantity = async (req, res) => {
  const { delta } = req.body;
  if (delta === undefined) return sendError(res, 'Delta is required', 400, 'BAD_REQUEST');

  const item = await db.prepare('SELECT * FROM stock WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Stock item not found', 404, 'NOT_FOUND');

  let newQuantity = Number(item.quantity) + Number(delta);
  if (newQuantity < 0) newQuantity = 0;

  const now = new Date().toISOString();
  db.prepare(`UPDATE stock SET quantity = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
    .run(newQuantity, now, req.params.id, req.user.id);

  const updatedItem = await db.prepare('SELECT * FROM stock WHERE id = ?').get(req.params.id);

  // Log transaction
  await db.prepare(`
    INSERT INTO stock_transactions (stock_id, user_id, type, quantity, date, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.params.id, req.user.id, delta > 0 ? 'in' : 'out', Math.abs(delta), now, now);

  return sendSuccess(res, enrichRow(updatedItem), 'Quantity adjusted');
};

// ── DELETE /:id ───────────────────────────────────────────────────────────────
const deleteStock = async (req, res) => {
  const item = await db.prepare('SELECT * FROM stock WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Stock item not found', 404, 'NOT_FOUND');

  await db.prepare('DELETE FROM stock WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  return res.status(204).end();
};

// ── GET /:id/history ──────────────────────────────────────────────────────────
const getStockHistory = async (req, res) => {
  const history = await db.prepare(`
    SELECT * FROM stock_transactions 
    WHERE stock_id = ? AND user_id = ? 
    ORDER BY created_at DESC 
    LIMIT 50
  `).all(req.params.id, req.user.id);
  
  return sendSuccess(res, history, 'Stock history fetched');
};

module.exports = { getStockStats, getStocks, createStock, getStock, updateStock, adjustQuantity, deleteStock, getStockHistory };
