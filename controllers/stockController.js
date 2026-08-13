const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { paginate } = require('../utils/pagination');

// ── Helper: derive status from quantity ───────────────────────────────────────
function deriveStatus(quantity, threshold = 5) {
  if (quantity === 0) return 'Out of Stock';
  if (quantity < threshold) return 'Low Stock';
  return 'In Stock';
}

// ── Helper: enrich a stock row with computed fields ──────────────────────────
function enrichRow(row) {
  if (!row) return row;
  const low_stock_threshold = Number(row.low_stock_threshold || row.lowstockthreshold || row.lowStockThreshold || row.low_stock_threshold || 5);
  return {
    ...row,
    low_stock_threshold,
    status: deriveStatus(Number(row.quantity || 0), low_stock_threshold),
    value: Number(row.quantity || 0) * Number(row.unit_price || 0),
  };
}

const ensureStockTable = async () => {
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS stock (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        sub_name TEXT,
        sku TEXT,
        category TEXT,
        unit TEXT DEFAULT 'PCS',
        unit_price REAL DEFAULT 0,
        cost_price REAL DEFAULT 0,
        quantity REAL DEFAULT 0,
        low_stock_threshold INTEGER DEFAULT 5,
        location TEXT,
        warehouse TEXT,
        supplier TEXT,
        supplier_name TEXT,
        notes TEXT,
        created_at TEXT,
        updated_at TEXT
      )
    `).run();
  } catch (e) {}
};

// ── GET /stats — Aggregate inventory statistics ────────────────────────────
const getStockStats = async (req, res) => {
  await ensureStockTable();
  const stats = await db.prepare(`
    SELECT
      COUNT(*)                                                              AS totalItems,
      COALESCE(SUM(quantity * unit_price), 0)                              AS totalValue,
      SUM(CASE WHEN quantity = 0             THEN 1 ELSE 0 END)            AS outOfStockCount,
      SUM(CASE WHEN quantity > 0 AND quantity < COALESCE(low_stock_threshold, 5) THEN 1 ELSE 0 END) AS lowStockCount,
      SUM(CASE WHEN quantity >= COALESCE(low_stock_threshold, 5)            THEN 1 ELSE 0 END) AS inStockCount
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
  await ensureStockTable();
  const { category, location, status, page, limit, sort = 'created_at', order = 'desc', search } = req.query;
  let query = 'SELECT * FROM stock WHERE user_id = ?';
  const params = [req.user.id];

  if (category) { query += ' AND category LIKE ?'; params.push(`%${category}%`); }
  if (location) { query += ' AND location LIKE ?'; params.push(`%${location}%`); }
  if (search)   { query += ' AND (LOWER(name) LIKE LOWER(?) OR LOWER(sku) LIKE LOWER(?) OR LOWER(category) LIKE LOWER(?) OR LOWER(sub_name) LIKE LOWER(?))'; params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`); }

  if (status === 'Out of Stock') { query += ' AND quantity = 0'; }
  else if (status === 'Low Stock') { query += ' AND quantity > 0 AND quantity < COALESCE(low_stock_threshold, 5)'; }
  else if (status === 'In Stock')  { query += ' AND quantity >= COALESCE(low_stock_threshold, 5)'; }

  const allowedSorts = ['created_at', 'updated_at', 'name', 'quantity', 'unit_price'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'created_at';
  const sortDir = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  query += ` ORDER BY ${sortCol} ${sortDir}`;

  const result = await paginate(query, params, page, limit, db);
  return sendSuccess(res, result.rows.map(enrichRow), 'Stock fetched', 200, result.meta);
};

// ── POST / ────────────────────────────────────────────────────────────────────
const createStock = async (req, res) => {
  const { name, sub_name, sku, quantity = 0, unit, unit_price, category, location, notes, low_stock_threshold } = req.body;
  if (!name) return sendError(res, 'Name is required', 400, 'BAD_REQUEST');

  const now = new Date().toISOString();
  const qty = Number(quantity || 0);
  const price = Number(unit_price || 0);
  const threshold = low_stock_threshold !== undefined ? Number(low_stock_threshold) : 5;
  const stmt = db.prepare(`
    INSERT INTO stock (user_id, name, sub_name, sku, quantity, unit, unit_price, category, location, notes, low_stock_threshold, created_at, updated_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = await stmt.run(req.user.id, name, sub_name || null, sku || null, qty, unit || null, price || null, category || null, location || null, notes || null, threshold, now, now);
  
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
  console.log('Update stock request body:', req.body);
  const item = await db.prepare('SELECT * FROM stock WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Stock item not found', 404, 'NOT_FOUND');

  const updates = [];
  const params = [];
  const allowedFields = ['name', 'sub_name', 'sku', 'quantity', 'unit', 'unit_price', 'category', 'location', 'notes', 'low_stock_threshold'];
  
  for (const field of allowedFields) {
    let val = req.body[field];
    if (field === 'low_stock_threshold' && val === undefined) {
      val = req.body.low_stock_threshold !== undefined ? req.body.low_stock_threshold : (req.body.lowstockthreshold !== undefined ? req.body.lowstockthreshold : req.body.lowStockThreshold);
    }
    if (val !== undefined) {
      updates.push(`${field} = ?`);
      if (field === 'quantity' || field === 'unit_price' || field === 'low_stock_threshold') val = Number(val);
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

  const now = new Date().toISOString();
  let updatedRow = null;

  // 1. Update business_products (catalog products created via Inventory -> Products)
  try {
    const bpItem = await db.prepare('SELECT * FROM business_products WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (bpItem) {
      let newQty = Number(bpItem.quantity || 0) + Number(delta);
      if (newQty < 0) newQty = 0;
      const stockStatus = newQty === 0 ? 'Out of Stock' : (newQty <= (bpItem.low_stock_threshold || 5) ? 'Low Stock' : 'In Stock');
      await db.prepare('UPDATE business_products SET quantity = ?, stock_status = ?, updated_at = ? WHERE id = ? AND user_id = ?')
        .run(newQty, stockStatus, now, req.params.id, req.user.id);
      updatedRow = await db.prepare('SELECT * FROM business_products WHERE id = ?').get(req.params.id);
    }
  } catch (e) {}

  // 2. Update stock table if present
  try {
    const stockItem = await db.prepare('SELECT * FROM stock WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (stockItem) {
      let newQty = Number(stockItem.quantity || 0) + Number(delta);
      if (newQty < 0) newQty = 0;
      await db.prepare('UPDATE stock SET quantity = ?, updated_at = ? WHERE id = ? AND user_id = ?')
        .run(newQty, now, req.params.id, req.user.id);
      if (!updatedRow) {
        updatedRow = enrichRow(await db.prepare('SELECT * FROM stock WHERE id = ?').get(req.params.id));
      }
    }
  } catch (e) {}

  if (!updatedRow) {
    return sendError(res, 'Product or Stock item not found', 404, 'NOT_FOUND');
  }

  // Log transaction
  try {
    const { purchase_bill_ref, received_by, warehouse_id } = req.body;
    await db.prepare(`
      INSERT INTO stock_transactions (stock_id, user_id, type, quantity, date, created_at, purchase_bill_ref, received_by, warehouse_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.params.id, 
      req.user.id, 
      delta > 0 ? 'in' : 'out', 
      Math.abs(delta), 
      now, 
      now,
      purchase_bill_ref || null,
      received_by || null,
      warehouse_id || null
    );
  } catch (e) {}

  return sendSuccess(res, updatedRow, 'Quantity adjusted successfully');
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
