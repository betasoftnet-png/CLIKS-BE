const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { paginate } = require('../utils/pagination');

const getWallets = async (req, res) => {
  const { page, limit, sort = 'created_at', order = 'desc', search, status } = req.query;
  let query = 'SELECT * FROM goal_wallets WHERE user_id = ?';
  const params = [req.user.id];

  if (search) {
    query += ' AND (name LIKE ? OR description LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  if (req.query.person_id) {
    query += ' AND person_id = ?';
    params.push(req.query.person_id);
  }

  const allowedSorts = ['created_at', 'updated_at', 'target_amount', 'current_amount', 'name'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'created_at';
  const sortDir = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  query += ` ORDER BY ${sortCol} ${sortDir}`;

  const result = await paginate(query, params, page, limit, db);
  return sendSuccess(res, result.rows, 'Wallets fetched', 200, result.meta);
};

const createWallet = async (req, res) => {
  const { name, target_amount, description, person_id } = req.body;
  if (!name || target_amount === undefined) return sendError(res, 'Name and target_amount are required', 400, 'BAD_REQUEST');

  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO goal_wallets (user_id, name, target_amount, description, current_amount, status, person_id, created_at, updated_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = await stmt.run(req.user.id, name, target_amount, description || null, 0, 'active', person_id || null, now, now);
  
  const newItem = await db.prepare('SELECT * FROM goal_wallets WHERE id = ?').get(info.lastInsertRowid);
  return sendSuccess(res, newItem, 'Wallet created', 201);
};

const getWallet = async (req, res) => {
  const item = await db.prepare('SELECT * FROM goal_wallets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Wallet not found', 404, 'NOT_FOUND');
  
  // Also fetch transactions
  const transactions = await db.prepare('SELECT * FROM wallet_transactions WHERE wallet_id = ? ORDER BY created_at DESC').all(req.params.id);
  item.transactions = transactions;

  return sendSuccess(res, item);
};

const addMoney = async (req, res) => {
  const { amount } = req.body;
  if (amount === undefined || amount <= 0) return sendError(res, 'Valid amount is required', 400, 'BAD_REQUEST');

  const wallet = await db.prepare('SELECT * FROM goal_wallets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!wallet) return sendError(res, 'Wallet not found', 404, 'NOT_FOUND');
  if (wallet.status === 'completed') return sendError(res, 'Cannot add money to a completed wallet', 400, 'BAD_REQUEST');

  const now = new Date().toISOString();
  
  // 1. Record transaction
  await db.prepare('INSERT INTO wallet_transactions (wallet_id, user_id, amount, type, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(req.params.id, req.user.id, amount, 'credit', now);

  // 2. Update wallet
  const newAmount = Number(wallet.current_amount || 0) + Number(amount);
  await db.prepare('UPDATE goal_wallets SET current_amount = ?, updated_at = ? WHERE id = ?')
    .run(newAmount, now, req.params.id);

  const updatedWallet = await db.prepare('SELECT * FROM goal_wallets WHERE id = ?').get(req.params.id);
  return sendSuccess(res, updatedWallet, 'Money added successfully');
};

const claimWallet = async (req, res) => {
  const wallet = await db.prepare('SELECT * FROM goal_wallets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!wallet) return sendError(res, 'Wallet not found', 404, 'NOT_FOUND');
  
  const current = Number(wallet.current_amount || 0);
  const target = Number(wallet.target_amount || 0);
  
  if (current < target) {
    return sendError(res, `Target not reached. You need ₹${target - current} more.`, 400, 'BAD_REQUEST');
  }

  if (wallet.status === 'completed') return sendError(res, 'Wallet already claimed', 400, 'BAD_REQUEST');

  const now = new Date().toISOString();
  await db.prepare('UPDATE goal_wallets SET status = ?, updated_at = ? WHERE id = ?')
    .run('completed', now, req.params.id);

  const updatedWallet = await db.prepare('SELECT * FROM goal_wallets WHERE id = ?').get(req.params.id);
  return sendSuccess(res, updatedWallet, 'Goal achieved and wallet claimed! 🎉');
};

const deleteWallet = async (req, res) => {
  const item = await db.prepare('SELECT * FROM goal_wallets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return sendError(res, 'Wallet not found', 404, 'NOT_FOUND');

  // Delete transactions too
  await db.prepare('DELETE FROM wallet_transactions WHERE wallet_id = ?').run(req.params.id);
  await db.prepare('DELETE FROM goal_wallets WHERE id = ?').run(req.params.id);
  
  return res.status(204).end();
};

module.exports = { getWallets, createWallet, getWallet, addMoney, claimWallet, deleteWallet };
