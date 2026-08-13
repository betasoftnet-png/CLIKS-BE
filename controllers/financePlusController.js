const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const connectionService = require('../utils/connectionService');

// ── Financial Goals ──────────────────────────────────────────────────────────
const getGoals = async (req, res) => {
  const goals = await db.prepare('SELECT * FROM financial_goals WHERE user_id = ?').all(req.user.id);
  return sendSuccess(res, goals);
};

const createGoal = async (req, res) => {
  const { name, target_amount, current_savings, target_date, category } = req.body;
  const now = new Date().toISOString();
  const info = await db.prepare(`
    INSERT INTO financial_goals (user_id, name, target_amount, current_savings, target_date, category, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.id, name, target_amount, current_savings || 0, target_date, category, now, now);

  const newGoal = await db.prepare('SELECT * FROM financial_goals WHERE id = ?').get(info.lastInsertRowid);
  return sendSuccess(res, newGoal, 'Goal created', 201);
};

const updateGoal = async (req, res) => {
  const { name, target_amount, current_savings, target_date, category, status } = req.body;
  await db.prepare(`
    UPDATE financial_goals SET name = ?, target_amount = ?, current_savings = ?, target_date = ?, category = ?, status = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(name, target_amount, current_savings, target_date, category, status, new Date().toISOString(), req.params.id, req.user.id);

  const updatedGoal = await db.prepare('SELECT * FROM financial_goals WHERE id = ?').get(req.params.id);
  return sendSuccess(res, updatedGoal, 'Goal updated');
};

const deleteGoal = async (req, res) => {
  await db.prepare('DELETE FROM financial_goals WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  return res.status(204).end();
};

// ── Salary Manager ────────────────────────────────────────────────────────────
const getSalaryRecords = async (req, res) => {
  const records = await db.prepare('SELECT * FROM salary_records WHERE user_id = ? ORDER BY salary_date DESC').all(req.user.id);
  return sendSuccess(res, records);
};

const createSalaryRecord = async (req, res) => {
  const { company_name, employee_id, salary_date, basic_salary, hra, da, bonus, other_allowances, gross_salary, net_salary, salary_slip_url, wallet_id } = req.body;
  const now = new Date().toISOString();

  await db.transaction(async () => {
    const info = await db.prepare(`
      INSERT INTO salary_records (user_id, company_name, employee_id, salary_date, basic_salary, hra, da, bonus, other_allowances, gross_salary, net_salary, salary_slip_url, wallet_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.user.id, company_name, employee_id, salary_date, basic_salary, hra, da, bonus, other_allowances, gross_salary, net_salary, salary_slip_url, wallet_id, now, now);

    // Automation: Update Wallet and Add to Income/Transactions
    if (wallet_id && net_salary > 0) {
      await db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ? AND user_id = ?')
        .run(net_salary, now, wallet_id, req.user.id);

      await db.prepare(`
        INSERT INTO transactions (user_id, account_id, type, amount, category, description, date, created_at, updated_at, name)
        VALUES (?, ?, 'income', ?, 'Salary', ?, ?, ?, ?, ?)
      `).run(req.user.id, wallet_id, net_salary, `Salary from ${company_name}`, salary_date || now, now, now, `Salary - ${company_name}`);
    }
  })();

  return sendSuccess(res, null, 'Salary record created and wallet updated', 201);
};

// ── Property Manager ──────────────────────────────────────────────────────────
const getPropertyRecords = async (req, res) => {
  const records = await db.prepare('SELECT * FROM property_records WHERE user_id = ?').all(req.user.id);
  return sendSuccess(res, records);
};

const createProperty = async (req, res) => {
  const { property_name, address, tenant_name, monthly_rent, security_deposit, due_date, last_received_date, maintenance_cost, property_tax, occupancy_status, wallet_id } = req.body;
  const now = new Date().toISOString();

  const info = await db.prepare(`
    INSERT INTO property_records (user_id, property_name, address, tenant_name, monthly_rent, security_deposit, due_date, last_received_date, maintenance_cost, property_tax, occupancy_status, wallet_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.id, property_name, address, tenant_name, monthly_rent, security_deposit, due_date, last_received_date, maintenance_cost, property_tax, occupancy_status, wallet_id, now, now);

  return sendSuccess(res, { id: info.lastInsertRowid }, 'Property created', 201);
};

const recordRentReceived = async (req, res) => {
  const { id } = req.params;
  const { amount, date, wallet_id } = req.body;
  const now = new Date().toISOString();

  const property = await db.prepare('SELECT * FROM property_records WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!property) return sendError(res, 'Property not found', 404);

  const targetWalletId = wallet_id || property.wallet_id;

  await db.transaction(async () => {
    await db.prepare('UPDATE property_records SET last_received_date = ?, updated_at = ? WHERE id = ?')
      .run(date || now, now, id);

    if (targetWalletId && amount > 0) {
      await db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ? AND user_id = ?')
        .run(amount, now, targetWalletId, req.user.id);

      await db.prepare(`
        INSERT INTO transactions (user_id, account_id, type, amount, category, description, date, created_at, updated_at, name)
        VALUES (?, ?, 'income', ?, 'Rent', ?, ?, ?, ?, ?)
      `).run(req.user.id, targetWalletId, amount, `Rent for ${property.property_name}`, date || now, now, now, `Rent - ${property.property_name}`);
    }
  })();

  return sendSuccess(res, null, 'Rent recorded and wallet updated');
};

// ── Pension Manager ───────────────────────────────────────────────────────────
const getPensionRecords = async (req, res) => {
  const records = await db.prepare('SELECT * FROM pension_records WHERE user_id = ?').all(req.user.id);
  return sendSuccess(res, records);
};

const recordPension = async (req, res) => {
  const { provider, pension_number, monthly_amount, payment_date, is_family_pension, pension_type, wallet_id } = req.body;
  const now = new Date().toISOString();

  await db.transaction(async () => {
    await db.prepare(`
      INSERT INTO pension_records (user_id, provider, pension_number, monthly_amount, payment_date, is_family_pension, pension_type, wallet_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.user.id, provider, pension_number, monthly_amount, payment_date, is_family_pension ? 1 : 0, pension_type, wallet_id, now, now);

    if (wallet_id && monthly_amount > 0) {
      await db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ? AND user_id = ?')
        .run(monthly_amount, now, wallet_id, req.user.id);

      await db.prepare(`
        INSERT INTO transactions (user_id, account_id, type, amount, category, description, date, created_at, updated_at, name)
        VALUES (?, ?, 'income', ?, 'Pension', ?, ?, ?, ?, ?)
      `).run(req.user.id, wallet_id, monthly_amount, `Pension from ${provider}`, payment_date || now, now, now, `Pension - ${provider}`);
    }
  })();

  return sendSuccess(res, null, 'Pension recorded and wallet updated', 201);
};

// ── Tax & Deductions ──────────────────────────────────────────────────────────
const getTaxRecords = async (req, res) => {
  const records = await db.prepare('SELECT * FROM tax_records WHERE user_id = ? ORDER BY tax_year DESC').all(req.user.id);
  return sendSuccess(res, records);
};

const saveTaxRecord = async (req, res) => {
  const { tax_year, income_tax, tds_paid, epf, esi, prof_tax, advance_tax, tax_savings, notes } = req.body;
  const now = new Date().toISOString();

  const existing = await db.prepare('SELECT id FROM tax_records WHERE user_id = ? AND tax_year = ?').get(req.user.id, tax_year);

  if (existing) {
    await db.prepare(`
      UPDATE tax_records SET income_tax = ?, tds_paid = ?, epf = ?, esi = ?, prof_tax = ?, advance_tax = ?, tax_savings = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `).run(income_tax, tds_paid, epf, esi, prof_tax, advance_tax, tax_savings, notes, now, existing.id);
  } else {
    await db.prepare(`
      INSERT INTO tax_records (user_id, tax_year, income_tax, tds_paid, epf, esi, prof_tax, advance_tax, tax_savings, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.user.id, tax_year, income_tax, tds_paid, epf, esi, prof_tax, advance_tax, tax_savings, notes, now, now);
  }

  return sendSuccess(res, null, 'Tax record saved');
};

const getNotifications = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) return sendSuccess(res, []);
    let list = [];
    try {
      list = await db.prepare('SELECT * FROM notifications WHERE receiver_id = ? OR user_id = ? ORDER BY id DESC LIMIT 100').all(userId, userId);
    } catch (e) {
      list = await db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(userId);
    }
    return sendSuccess(res, list || []);
  } catch (error) {
    console.error('[financePlus getNotifications Error]', error);
    return sendSuccess(res, []);
  }
};

const markNotificationRead = async (req, res) => {
  await db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  return sendSuccess(res, null, 'Marked as read');
};

// ── Role-Based Settings & Global Budget ───────────────────────────────────────
const updateFinanceSettings = async (req, res) => {
  const { source, global_budget, receive_purchase_data } = req.body;
  const updates = [];
  const params = [];

  if (source !== undefined) {
    updates.push('primary_income_source = ?');
    params.push(source);
  }

  if (global_budget !== undefined) {
    updates.push('global_budget = ?');
    params.push(global_budget);
  }

  if (receive_purchase_data !== undefined) {
    updates.push('receive_purchase_data = ?');
    params.push(receive_purchase_data ? 1 : 0);
  }

  if (updates.length > 0) {
    params.push(new Date().toISOString(), req.user.id);
    await db.prepare(`UPDATE users SET ${updates.join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...params);
  }

  return sendSuccess(res, null, 'Finance preferences updated');
};

const updatePrimaryIncomeSource = async (req, res) => {
  const { source } = req.body;
  await db.prepare('UPDATE users SET primary_income_source = ?, updated_at = ? WHERE id = ?')
    .run(source, new Date().toISOString(), req.user.id);
  return sendSuccess(res, null, 'Income source preference updated');
};

// ── Money Trackers ────────────────────────────────────────────────────────────
const getMoneyTrackers = async (req, res) => {
  const { search, category, place, date, name } = req.query;
  let queryStr = 'SELECT * FROM money_trackers WHERE user_id = ?';
  const params = [req.user.id];

  if (search) {
    queryStr += ' AND (category LIKE ? OR place LIKE ? OR date LIKE ? OR name LIKE ?)';
    const searchVal = `%${search}%`;
    params.push(searchVal, searchVal, searchVal, searchVal);
  } else {
    if (category) {
      queryStr += ' AND category = ?';
      params.push(category);
    }
    if (place) {
      queryStr += ' AND place LIKE ?';
      params.push(`%${place}%`);
    }
    if (date) {
      queryStr += ' AND date LIKE ?';
      params.push(`%${date}%`);
    }
    if (name) {
      queryStr += ' AND name LIKE ?';
      params.push(`%${name}%`);
    }
  }

  queryStr += ' ORDER BY created_at DESC';
  const trackers = await db.prepare(queryStr).all(params);
  
  // Parse JSON strings before returning to client
  const parsedTrackers = trackers.map(t => ({
    ...t,
    details: t.details ? JSON.parse(t.details) : {},
    expenses: t.expenses ? JSON.parse(t.expenses) : [],
    locations: t.locations ? JSON.parse(t.locations) : [],
    photos: t.photos ? JSON.parse(t.photos) : [],
    timeline: t.timeline ? JSON.parse(t.timeline) : [],
    memories: t.memories ? JSON.parse(t.memories) : [],
    route_map: t.route_map ? JSON.parse(t.route_map) : {}
  }));

  return sendSuccess(res, parsedTrackers);
};

const createMoneyTracker = async (req, res) => {
  const { category, name, place, date, budget, details, expenses, locations, photos, timeline, memories, route_map } = req.body;
  const now = new Date().toISOString();

  const info = await db.prepare(`
    INSERT INTO money_trackers (
      user_id, category, name, place, date, budget, details, expenses, locations, photos, timeline, memories, route_map, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.user.id,
    category,
    name,
    place || '',
    date || '',
    budget || 0,
    JSON.stringify(details || {}),
    JSON.stringify(expenses || []),
    JSON.stringify(locations || []),
    JSON.stringify(photos || []),
    JSON.stringify(timeline || []),
    JSON.stringify(memories || []),
    JSON.stringify(route_map || {}),
    now,
    now
  );

  const newTracker = await db.prepare('SELECT * FROM money_trackers WHERE id = ?').get(info.lastInsertRowid);
  if (newTracker) {
    newTracker.details = newTracker.details ? JSON.parse(newTracker.details) : {};
    newTracker.expenses = newTracker.expenses ? JSON.parse(newTracker.expenses) : [];
    newTracker.locations = newTracker.locations ? JSON.parse(newTracker.locations) : [];
    newTracker.photos = newTracker.photos ? JSON.parse(newTracker.photos) : [];
    newTracker.timeline = newTracker.timeline ? JSON.parse(newTracker.timeline) : [];
    newTracker.memories = newTracker.memories ? JSON.parse(newTracker.memories) : [];
    newTracker.route_map = newTracker.route_map ? JSON.parse(newTracker.route_map) : {};
  }

  return sendSuccess(res, newTracker, 'Money tracker created', 201);
};

const getMoneyTrackerById = async (req, res) => {
  const tracker = await db.prepare('SELECT * FROM money_trackers WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!tracker) {
    return sendError(res, 'Money tracker not found', 404);
  }

  const parsed = {
    ...tracker,
    details: tracker.details ? JSON.parse(tracker.details) : {},
    expenses: tracker.expenses ? JSON.parse(tracker.expenses) : [],
    locations: tracker.locations ? JSON.parse(tracker.locations) : [],
    photos: tracker.photos ? JSON.parse(tracker.photos) : [],
    timeline: tracker.timeline ? JSON.parse(tracker.timeline) : [],
    memories: tracker.memories ? JSON.parse(tracker.memories) : [],
    route_map: tracker.route_map ? JSON.parse(tracker.route_map) : {}
  };

  return sendSuccess(res, parsed);
};

const updateMoneyTracker = async (req, res) => {
  const { name, place, date, budget, details, expenses, locations, photos, timeline, memories, route_map } = req.body;
  const now = new Date().toISOString();

  const existing = await db.prepare('SELECT id FROM money_trackers WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!existing) {
    return sendError(res, 'Money tracker not found', 404);
  }

  await db.prepare(`
    UPDATE money_trackers SET 
      name = ?, place = ?, date = ?, budget = ?, details = ?, expenses = ?, locations = ?, photos = ?, timeline = ?, memories = ?, route_map = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(
    name,
    place,
    date,
    budget,
    JSON.stringify(details || {}),
    JSON.stringify(expenses || []),
    JSON.stringify(locations || []),
    JSON.stringify(photos || []),
    JSON.stringify(timeline || []),
    JSON.stringify(memories || []),
    JSON.stringify(route_map || {}),
    now,
    req.params.id,
    req.user.id
  );

  const updatedTracker = await db.prepare('SELECT * FROM money_trackers WHERE id = ?').get(req.params.id);
  if (updatedTracker) {
    updatedTracker.details = updatedTracker.details ? JSON.parse(updatedTracker.details) : {};
    updatedTracker.expenses = updatedTracker.expenses ? JSON.parse(updatedTracker.expenses) : [];
    updatedTracker.locations = updatedTracker.locations ? JSON.parse(updatedTracker.locations) : [];
    updatedTracker.photos = updatedTracker.photos ? JSON.parse(updatedTracker.photos) : [];
    updatedTracker.timeline = updatedTracker.timeline ? JSON.parse(updatedTracker.timeline) : [];
    updatedTracker.memories = updatedTracker.memories ? JSON.parse(updatedTracker.memories) : [];
    updatedTracker.route_map = updatedTracker.route_map ? JSON.parse(updatedTracker.route_map) : {};
  }

  return sendSuccess(res, updatedTracker, 'Money tracker updated');
};

const deleteMoneyTracker = async (req, res) => {
  const existing = await db.prepare('SELECT id FROM money_trackers WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!existing) {
    return sendError(res, 'Money tracker not found', 404);
  }
  await db.prepare('DELETE FROM money_trackers WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  return res.status(204).end();
};

// ── Customer Purchase History & Loyalty ───────────────────────────────────────
const getCustomerPurchases = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const userId = req.user.id;
  const userEmail = req.user.email ? String(req.user.email).trim().toLowerCase() : '';

  try {
    const { syncConnectedCustomerPurchases } = require('../utils/customerIntegration');
    await syncConnectedCustomerPurchases(userId, userEmail);
  } catch (syncErr) {
    console.warn('[financePlusController] Auto-sync warning:', syncErr.message);
  }

  const purchases = await db.prepare(`
    SELECT * FROM customer_purchase_history 
    WHERE customer_user_id = ? OR LOWER(customer_email) = ? 
    ORDER BY created_at DESC, id DESC
  `).all(userId, userEmail);

  const rawList = Array.isArray(purchases) ? purchases : [];

  // Filter out invoices from merchants where connection status is rejected
  const activeConnRows = await db.prepare(`
    SELECT business_id, status FROM customer_connections
    WHERE website_user_id = ? ${userEmail ? 'OR LOWER(customer_email) = ?' : ''}
  `).all(...(userEmail ? [userId, userEmail] : [userId]));

  const rejectedBusinessIds = new Set(
    (activeConnRows || []).filter(r => String(r.status).toLowerCase() === 'rejected').map(r => r.business_id)
  );

  const filtered = rawList.filter(p => {
    if (p.merchant_business_id && rejectedBusinessIds.has(p.merchant_business_id)) {
      return false;
    }
    const s1 = p.sendToCustomerHistory;
    const s2 = p.sendPurchaseHistoryToCustomer;
    return (s1 === true || s1 === 1 || String(s1) === '1' || String(s1).toLowerCase() === 'true' || s1 === undefined || s1 === null) &&
           (s2 === true || s2 === 1 || String(s2) === '1' || String(s2).toLowerCase() === 'true' || s2 === undefined || s2 === null);
  });

  // Normalize fields to match frontend expectations and guarantee records are not discarded
  const normalized = filtered.map(p => ({
    ...p,
    sendToCustomerHistory: true,
    send_to_customer_history: true,
    sendPurchaseHistoryToCustomer: true,
    grand_total: p.net_amount || p.total_amount,
    purchase_status: p.invoice_status || 'Paid',
    points_earned: parseInt(p.points_earned) || Math.floor((p.net_amount || p.total_amount) / 100),
    timestamp: p.created_at || p.invoice_date
  }));

  return sendSuccess(res, normalized);
};

const getIntegrations = async (req, res) => {
  try {
    const list = await connectionService.getWebsiteUserIntegrations(req.user.id, req.user.email);
    return sendSuccess(res, list, 'Integrations fetched successfully');
  } catch (error) {
    console.error('[getIntegrations Error]', error);
    return sendError(res, 'Failed to fetch active integrations', 500);
  }
};

const respondIntegration = async (req, res) => {
  try {
    const { id } = req.params;
    const { action, status } = req.body || {};
    const targetAction = action || status;
    const updated = await connectionService.respondToIntegrationRequest({
      website_user_id: req.user.id,
      website_user_email: req.user.email,
      connection_id: id,
      action: targetAction
    });
    return sendSuccess(res, updated, 'Connection request updated successfully');
  } catch (error) {
    console.error('[respondIntegration Error]', error);
    const code = error.statusCode || 500;
    return sendError(res, error.message || 'Failed to update integration status', code);
  }
};

const getLoyaltyStats = async (req, res) => {
  const wallet = await db.prepare('SELECT * FROM customer_loyalty_wallets WHERE user_id = ?').get(req.user.id);
  if (!wallet) {
    return sendSuccess(res, {
      available_points: 0,
      lifetime_earned: 0,
      total_redeemed: 0
    });
  }
  return sendSuccess(res, {
    available_points: wallet.points_balance,
    lifetime_earned: wallet.total_earned,
    total_redeemed: wallet.total_redeemed
  });
};

const getInvoiceDetails = async (req, res) => {
  try {
      const targetId = req.params.invoiceId || req.params.id; // business_invoices.id OR customer_purchase_history.id/invoice_id
      const userId = req.user ? req.user.id : null;

      console.log(`[DEBUG] getInvoiceDetails - Received targetId: ${targetId}, User ID: ${userId}`);

      // Security Check: Verify this user owns this purchase via history table
      let userEmail = '';
      if (userId) {
          const user = await db.prepare('SELECT email FROM users WHERE id = ?').get(userId);
          userEmail = user?.email ? user.email.toLowerCase().trim() : '';
      }

      let purchaseRecord = await db.prepare(`
          SELECT *, net_amount, total_amount
          FROM customer_purchase_history
          WHERE (id = ? OR invoice_id = ? OR invoice_number = ?)
            ${userId ? 'AND (customer_user_id = ? OR (customer_email IS NOT NULL AND LOWER(customer_email) = ?))' : ''}
      `).get(...(userId ? [targetId, targetId, targetId, userId, userEmail] : [targetId, targetId, targetId]));

      // Fallback: If not matched directly by customer_user_id/email, check if connection is accepted
      if (!purchaseRecord && userId) {
          const rec = await db.prepare(`
              SELECT *, net_amount, total_amount FROM customer_purchase_history
              WHERE id = ? OR invoice_id = ? OR invoice_number = ?
          `).get(targetId, targetId, targetId);

          if (rec) {
              const conn = await db.prepare(`
                  SELECT status FROM customer_connections
                  WHERE business_id = ? AND (website_user_id = ? OR (customer_email IS NOT NULL AND LOWER(customer_email) = ?))
              `).get(rec.merchant_business_id, userId, userEmail);

              if (conn && String(conn.status).toLowerCase() === 'accepted') {
                  purchaseRecord = rec;
              }
          }
      }

      // Direct fallback to business_invoices table if purchase_history record was created before connection
      let invoice = null;
      if (purchaseRecord) {
          const actualInvId = purchaseRecord.invoice_id || purchaseRecord.id;
          invoice = await db.prepare('SELECT * FROM business_invoices WHERE id = ? OR invoice_number = ?').get(actualInvId, purchaseRecord.invoice_number);
      }

      if (!invoice) {
          invoice = await db.prepare('SELECT * FROM business_invoices WHERE id = ? OR invoice_number = ?').get(targetId, targetId);
          if (invoice && userId) {
              const conn = await db.prepare(`
                  SELECT status FROM customer_connections
                  WHERE business_id = ? AND (website_user_id = ? OR (customer_email IS NOT NULL AND LOWER(customer_email) = ?))
              `).get(invoice.user_id, userId, userEmail);
              if (invoice.client_email && invoice.client_email.toLowerCase().trim() === userEmail) {
                  // Authorized by email
              } else if (conn && String(conn.status).toLowerCase() === 'accepted') {
                  // Authorized by connection
              } else {
                  invoice = null;
              }
          }
      }

      if (!purchaseRecord && !invoice) {
          console.warn(`[DEBUG] Security Violation or Missing Record: User ${userId} tried to access invoice ${targetId}`);
          return sendError(res, 'Unauthorized access to this invoice', 403);
      }

      if (!invoice && purchaseRecord) {
          invoice = {
              id: purchaseRecord.id,
              invoice_number: purchaseRecord.invoice_number,
              total_amount: purchaseRecord.total_amount || purchaseRecord.net_amount,
              grand_total: purchaseRecord.total_amount || purchaseRecord.net_amount,
              amount: purchaseRecord.total_amount || purchaseRecord.net_amount,
              status: purchaseRecord.payment_status || 'Paid',
              invoice_status: purchaseRecord.invoice_status || purchaseRecord.payment_status || 'Paid',
              user_id: purchaseRecord.merchant_business_id,
              client_name: purchaseRecord.customer_name,
              client_email: purchaseRecord.customer_email,
              items: purchaseRecord.items || '[]'
          };
      }

      const merchantId = invoice.user_id || (purchaseRecord ? purchaseRecord.merchant_business_id : 0);
      const merchant = await db.prepare('SELECT business_name, email FROM users WHERE id = ?').get(merchantId);

      // Fetch all payment installments
      let payments = [];
      try {
          payments = await db.prepare('SELECT * FROM business_invoice_payments WHERE invoice_id = ? ORDER BY payment_date DESC').all(invoice.id || targetId);
      } catch (e) {}

      // Loyalty Calculation - MUST match getCustomerPurchases exactly for consistency
      let loyaltyTx = null;
      try {
          loyaltyTx = await db.prepare(`
              SELECT points_earned, points_redeemed
              FROM customer_loyalty_transactions
              WHERE user_id = ? AND (invoice_number = ? OR invoice_number = ?)
          `).get(userId, invoice?.invoice_number, purchaseRecord?.invoice_number);
      } catch (e) {}

      const baseAmount = purchaseRecord?.net_amount ||
                         purchaseRecord?.total_amount ||
                         invoice?.total_amount ||
                         invoice?.grand_total ||
                         invoice?.amount || 0;

      const earnedPoints = (loyaltyTx && loyaltyTx.points_earned !== undefined) ? loyaltyTx.points_earned : Math.floor(parseFloat(baseAmount) / 100);

      // Parse JSON items
      let parsedItems = [];
      if (invoice.items) {
          try {
              parsedItems = typeof invoice.items === 'string' ? JSON.parse(invoice.items) : invoice.items;
          } catch (e) {
              console.warn('Failed to parse invoice items JSON', e);
          }
      }

      // Prepare response following the requirements
      const detailedInvoice = {
          ...invoice,
          items: parsedItems,
          // Ensure we have total_amount and amount for summary consistency
          total_amount: invoice.total_amount || invoice.grand_total || purchaseRecord?.net_amount || 0,
          grand_total: invoice.grand_total || invoice.total_amount || purchaseRecord?.net_amount || 0,
          amount: invoice.amount || invoice.subtotal || purchaseRecord?.total_amount || 0,
          merchant: {
              name: merchant?.business_name || invoice.merchant_name || purchaseRecord.merchant_name || 'CLIKS Merchant',
              email: merchant?.email || 'N/A',
              logo: null
          },
          customer: {
              name: invoice.client_name || purchaseRecord.customer_name || 'Customer',
              email: invoice.client_email || purchaseRecord.customer_email || 'N/A',
              gstin: invoice.client_gstin || purchaseRecord.customer_gstin,
              shipping_address: invoice.shipping_address || purchaseRecord.shipping_address
          },
          payment_info: {
              mode: invoice.payment_mode || purchaseRecord.payment_mode || 'Cash',
              history: payments.map(p => ({
                  method: p.payment_method,
                  amount: p.amount,
                  date: p.payment_date,
                  ref: p.reference_number,
                  notes: p.notes
              }))
          },
          loyalty: {
              earned: earnedPoints,
              redeemed: loyaltyTx?.points_redeemed || 0
          }
      };

      return sendSuccess(res, detailedInvoice, 'Invoice details loaded successfully');

  } catch (error) {
      console.error('[financePlusController] getInvoiceDetails CRITICAL ERROR:', error);
      return sendError(res, 'Internal Server Error during invoice retrieval: ' + error.message, 500);
  }
};

module.exports = {
  getGoals, createGoal, updateGoal, deleteGoal,
  getSalaryRecords, createSalaryRecord,
  getPropertyRecords, createProperty, recordRentReceived,
  getPensionRecords, recordPension,
  getTaxRecords, saveTaxRecord,
  getNotifications, markNotificationRead,
  updateFinanceSettings, updatePrimaryIncomeSource,
  getMoneyTrackers, createMoneyTracker, getMoneyTrackerById, updateMoneyTracker, deleteMoneyTracker,
  getCustomerPurchases, getLoyaltyStats, getInvoiceDetails,
  getIntegrations, respondIntegration
};
