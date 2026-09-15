const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

// Helper: strip password_hash from user row
const initColumns = async () => {
  const columns = [
    'tier TEXT DEFAULT \'Free Plan\'',
    'subscription_days_remaining INTEGER DEFAULT 0',
    'active_subscriptions TEXT',
    'favorite_products TEXT',
    'receive_purchase_data INTEGER DEFAULT 1'
  ];
  for (const col of columns) {
    try {
      await db.prepare(`ALTER TABLE users ADD COLUMN ${col}`).run();
    } catch (e) {}
  }
};
initColumns();

const safeUser = (user) => {
  if (!user) return null;
  const { password_hash: _password_hash, ...safe } = user;
  safe.name = user.username; // Map database username to name expected by the frontend

  let parsedSubs = null;
  if (user.active_subscriptions) {
    try {
      parsedSubs = typeof user.active_subscriptions === 'string'
        ? JSON.parse(user.active_subscriptions)
        : user.active_subscriptions;
    } catch (e) {
      console.warn('Failed to parse active_subscriptions JSON:', e);
    }
  }

  const userCreatedAt = user.created_at || new Date().toISOString();
  const rawBusiness = parsedSubs?.business || { active: true, plan: user.tier || 'Starter Plan' };
  const rawFinPro = parsedSubs?.fin_pro || (Boolean(user.finpro_plan || user.ca_plan) ? { active: true, plan: user.finpro_plan || user.ca_plan } : null);
  const rawInvestor = parsedSubs?.investor || (Boolean(user.investor_plan || user.betaclub_investor_plan) ? { active: true, plan: user.investor_plan || user.betaclub_investor_plan } : null);
  const rawPoster = parsedSubs?.poster || (Boolean(user.poster_plan || user.founder_plan) ? { active: true, plan: user.poster_plan || user.founder_plan } : null);

  const enrichSub = (sub, defaultPlan, defaultDays = 365) => {
    if (!sub) return { active: false, plan: null };
    const plan = sub.plan || defaultPlan;
    const startDate = sub.startDate || sub.updated_at || userCreatedAt;
    const isMonthly = String(plan).toLowerCase().includes('monthly');
    const duration = sub.duration_days || (isMonthly ? 30 : defaultDays);
    const startMs = new Date(startDate).getTime() || Date.now();
    const expiryDate = sub.expiryDate || sub.valid_until || new Date(startMs + duration * 24 * 60 * 60 * 1000).toISOString();
    return {
      ...sub,
      active: sub.active ?? true,
      plan,
      startDate,
      expiryDate,
      valid_until: expiryDate
    };
  };

  safe.active_subscriptions = {
    business: enrichSub(rawBusiness, user.tier || 'Starter Plan', 365),
    fin_pro: enrichSub(rawFinPro, 'Fin-Pro Solo', 365),
    investor: enrichSub(rawInvestor, 'Basic Investor', 365),
    poster: enrichSub(rawPoster, 'Monthly Innovator', 30)
  };

  return safe;
};

// ── GET / — Return current user ───────────────────────────────────────────────
const getProfile = async (req, res) => {
  let user;
  if (req.user.role === 'admin') {
    user = await db.prepare('SELECT * FROM platform_admins WHERE id = ?').get(req.user.id);
  } else if (req.user.role === 'sales_agent') {
    user = await db.prepare('SELECT * FROM sales_agents WHERE id = ?').get(req.user.id);
  } else if (req.user.role === 'support_agent') {
    user = await db.prepare('SELECT * FROM support_agents WHERE id = ?').get(req.user.id);
  } else {
    user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  }

  if (!user) return sendError(res, 'User not found', 404, 'NOT_FOUND');
  
  if (req.user.role === 'admin' || req.user.role === 'sales_agent' || req.user.role === 'support_agent') {
    const { password_hash: _password_hash, ...safe } = user;
    safe.role = req.user.role;
    return sendSuccess(res, safe);
  }
  
  const finalUser = safeUser(user);
  if (req.user.is_sub_id) {
    finalUser.email = req.user.sub_email;
    finalUser.is_sub_id = true;
    finalUser.parent_email = req.user.email; // (which was set to parent_email in auth.js)
    if (req.user.permissions) {
      finalUser.permissions = req.user.permissions;
    }
  }
  
  return sendSuccess(res, finalUser);
};

// ── PATCH / — Update username, email, or avatar ───────────────────────────────
const updateProfile = async (req, res) => {
  const bodyData = { ...req.query, ...req.body };
  const { username, email, name, avatar_data, avatar_name, tier, subscription_days_remaining, active_subscriptions, favorite_products } = bodyData;
  const targetUsername = username || name;

  if (!targetUsername && !email && !avatar_data && tier === undefined && subscription_days_remaining === undefined && active_subscriptions === undefined && favorite_products === undefined) {
    return sendError(res, 'Provide at least one field to update', 400, 'BAD_REQUEST');
  }

  let table = 'users';
  let nameField = 'username';
  if (req.user.role === 'admin') {
    table = 'platform_admins';
    nameField = 'name';
  } else if (req.user.role === 'sales_agent') {
    table = 'sales_agents';
    nameField = 'name';
  } else if (req.user.role === 'support_agent') {
    table = 'support_agents';
    nameField = 'name';
  }

  const current = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.user.id);
  if (!current) return sendError(res, 'User not found', 404, 'NOT_FOUND');

  let avatar_url = null;
  if (avatar_data && avatar_name && table === 'users') {
    try {
      const base64Data = avatar_data.replace(/^data:.*?;base64,/, '');
      const ext = path.extname(avatar_name) || '.png';
      const fileName = `avatar-${randomUUID()}${ext}`;
      const uploadPath = path.join(__dirname, '../uploads', fileName);
      
      fs.writeFileSync(uploadPath, base64Data, 'base64');
      avatar_url = `/uploads/${fileName}`;
    } catch (err) {
      console.error('Avatar upload error:', err);
    }
  }

  // Check email uniqueness if changing
  if (email && email !== current.email) {
    const existing = await db.prepare(`SELECT id FROM ${table} WHERE email = ? AND id != ?`).get(email, req.user.id);
    if (existing) return sendError(res, 'Email is already in use by another account', 409, 'CONFLICT');
  }

  const updates = [];
  const params = [];

  if (targetUsername !== undefined) { updates.push(`${nameField} = ?`); params.push(targetUsername); }
  if (email !== undefined)    { updates.push('email = ?');    params.push(email); }
  if (avatar_url)             { updates.push('avatar_url = ?'); params.push(avatar_url); }

  if (table === 'users') {
    if (tier !== undefined) { updates.push('tier = ?'); params.push(tier); }
    if (subscription_days_remaining !== undefined) { updates.push('subscription_days_remaining = ?'); params.push(subscription_days_remaining); }
    if (active_subscriptions !== undefined) {
      const activeSubsStr = typeof active_subscriptions === 'object' ? JSON.stringify(active_subscriptions) : active_subscriptions;
      updates.push('active_subscriptions = ?');
      params.push(activeSubsStr);
    }
    if (favorite_products !== undefined) { updates.push('favorite_products = ?'); params.push(favorite_products); }
    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
  }
  params.push(req.user.id);

  await db.prepare(`UPDATE ${table} SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const updated = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.user.id);
  
  if (table === 'users') {
    return sendSuccess(res, safeUser(updated), 'Profile updated');
  } else {
    const { password_hash: _password_hash, ...safe } = updated;
    safe.role = req.user.role;
    return sendSuccess(res, safe, 'Profile updated');
  }
};

// ── PATCH /change-password ────────────────────────────────────────────────────
const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return sendError(res, 'currentPassword and newPassword are required', 400, 'BAD_REQUEST');
  }

  let table = 'users';
  if (req.user.role === 'admin') {
    table = 'platform_admins';
  } else if (req.user.role === 'sales_agent') {
    table = 'sales_agents';
  }

  const user = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.user.id);
  if (!user) return sendError(res, 'User not found', 404, 'NOT_FOUND');

  const valid = bcrypt.compareSync(currentPassword, user.password_hash);
  if (!valid) return sendError(res, 'Current password is incorrect', 401, 'UNAUTHORIZED');

  const newHash = bcrypt.hashSync(newPassword, 10);
  if (table === 'users') {
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(newHash, new Date().toISOString(), req.user.id);
  } else {
    db.prepare(`UPDATE ${table} SET password_hash = ? WHERE id = ?`)
      .run(newHash, req.user.id);
  }

  return sendSuccess(res, { message: 'Password updated' }, 'Password updated');
};

// ── GET /subscription/:email ──────────────────────────────────────────────────
const getSubscriptionDetails = async (req, res) => {
  const email = req.params.email;
  
  if (!email) {
    return sendError(res, 'Email parameter is required', 400, 'BAD_REQUEST');
  }

  const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return sendError(res, 'User not found', 404, 'NOT_FOUND');

  const now = new Date();
  const subscribedAt = new Date(user.created_at || now.toISOString());
  
  // subscription_days_remaining in the DB actually acts as the total duration (e.g., 365)
  const totalSubDays = user.subscription_days_remaining || 0;

  // Next due date = Subscribed date + total days
  const nextDueDate = new Date(subscribedAt.getTime() + totalSubDays * 24 * 60 * 60 * 1000);

  // Actual remaining days = Next due date - Now
  let actualRemaining = Math.ceil((nextDueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (actualRemaining < 0) actualRemaining = 0;

  const subscriptionDetails = {
    email: user.email,
    plan_name: user.tier || 'Free Plan',
    when_subscribed: user.created_at,
    next_due_date: nextDueDate.toISOString(),
    subscription_days_remaining: actualRemaining
  };

  return sendSuccess(res, subscriptionDetails);
};

module.exports = { getProfile, updateProfile, changePassword, getSubscriptionDetails };
