const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

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
  const { source, global_budget } = req.body;
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
  const purchases = await db.prepare('SELECT * FROM customer_purchase_history WHERE customer_user_id = ? ORDER BY created_at DESC').all(req.user.id);

  // Normalize fields to match frontend expectations
  const normalized = purchases.map(p => ({
    ...p,
    grand_total: p.net_amount || p.total_amount,
    purchase_status: p.invoice_status,
    points_earned: Math.floor((p.net_amount || p.total_amount) / 100),
    timestamp: p.created_at
  }));

  return sendSuccess(res, normalized);
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

<<<<<<< HEAD
const getInvoiceById = async (req, res) => {
  const { invoiceId } = req.params;
  const searchId = String(invoiceId).trim();
  const userId = req.user ? req.user.id : 'N/A';
  const userEmail = req.user && req.user.email ? String(req.user.email).trim().toLowerCase() : '';

  console.log(`[FinancePlus Controller] getInvoiceById requested for identifier: "${searchId}" by user ID: ${userId}, email: ${userEmail || 'N/A'}`);

  try {
    let invoice = null;
    let historyRec = null;

    // 1. Search customer_purchase_history by invoice_id, id, or invoice_number
    historyRec = await db.prepare(`
      SELECT * FROM customer_purchase_history 
      WHERE invoice_id = ? OR id = ? OR invoice_number = ?
    `).get(searchId, searchId, searchId);

    // 2. Search business_invoices by id or invoice_number
    invoice = await db.prepare(`
      SELECT * FROM business_invoices 
      WHERE id = ? OR invoice_number = ?
    `).get(searchId, searchId);

    if (!invoice && !historyRec) {
      console.warn(`[FinancePlus Controller] ⚠️ Invoice NOT found in database for identifier: "${searchId}". Searched tables: customer_purchase_history (by invoice_id, id, invoice_number) and business_invoices (by id, invoice_number). Request User ID: ${userId}`);
      return sendError(res, `Invoice details not found for identifier "${searchId}"`, 404);
    }

    const realInvoiceId = (invoice && invoice.id) || (historyRec && historyRec.invoice_id) || (historyRec && historyRec.id) || parseInt(searchId);

    // 3. Fetch items from child table invoice_items
    let itemsFromTable = [];
    try {
      itemsFromTable = await db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(realInvoiceId);
    } catch (e) {
      console.warn('[FinancePlus Controller] Warning reading invoice_items:', e.message);
    }

    let parsedItems = [];
    if (Array.isArray(itemsFromTable) && itemsFromTable.length > 0) {
      parsedItems = itemsFromTable;
    } else {
      const rawItems = (invoice && invoice.items) || (historyRec && historyRec.items) || [];
      if (typeof rawItems === 'string') {
        try { parsedItems = JSON.parse(rawItems); } catch (e) { parsedItems = []; }
      } else if (Array.isArray(rawItems)) {
        parsedItems = rawItems;
      }
    }

    const formattedItems = (parsedItems || []).map(it => {
      const name = it.product_name || it.description || it.name || 'Item';
      const desc = it.description || it.product_name || it.name || 'Item';
      const qty = parseFloat(it.quantity) || 1;
      const price = parseFloat(it.price || it.rate || it.unit_price) || 0;
      const discPct = parseFloat(it.discount_percent) || 0;
      const discAmt = parseFloat(it.discount_amount) || 0;
      const gstPct = parseFloat(it.tax_rate || it.gst_percentage || it.gst_rate || it.gst_percent) || 0;
      const gstAmt = parseFloat(it.tax_amount || it.gst_amount) || (qty * price * (gstPct / 100));
      const lineTotal = parseFloat(it.total || it.amount || it.item_total) || ((qty * price) - discAmt + gstAmt);

      return {
        product_name: name,
        productName: name,
        description: desc,
        hsn_code: it.hsn_code || it.sku || it.sku_hsn || '',
        sku: it.hsn_code || it.sku || it.sku_hsn || '',
        sku_hsn: it.sku_hsn || it.hsn_code || it.sku || '',
        quantity: qty,
        unit: it.unit || 'Pcs',
        price: price,
        unit_price: price,
        unitPrice: price,
        rate: price,
        discount_percent: discPct,
        discount_amount: discAmt,
        gst_percent: gstPct,
        tax_rate: gstPct,
        gst_amount: gstAmt,
        tax_amount: gstAmt,
        total: lineTotal,
        item_total: lineTotal,
        line_total: lineTotal
      };
    });

    const invNum = (invoice && invoice.invoice_number) || (historyRec && historyRec.invoice_number) || searchId;
    const mName = (historyRec && historyRec.merchant_name) || 'CLIKS Merchant';
    const cName = (historyRec && historyRec.customer_name) || (invoice && invoice.client_name) || 'Customer';
    const cEmail = (historyRec && historyRec.customer_email) || (invoice && invoice.client_email) || '';
    const invDate = (invoice && invoice.created_at) || (historyRec && historyRec.invoice_date) || '';
    const pMode = (invoice && invoice.payment_mode) || (historyRec && historyRec.payment_mode) || 'Cash';
    const pStatus = (historyRec && historyRec.payment_status) || (invoice && invoice.status) || 'Paid';
    const shipAddr = (invoice && invoice.shipping_address) || (historyRec && historyRec.shipping_address) || '';
    const numGst = parseFloat((invoice && invoice.tax_amount) || (historyRec && historyRec.gst) || 0);
    const numDisc = parseFloat((invoice && invoice.discount_amount) || (historyRec && historyRec.discount) || 0);
    const loyaltyPts = (historyRec && historyRec.points_earned) || Math.floor(parseFloat((invoice && invoice.total_amount) || (historyRec && historyRec.net_amount) || 0) / 100);

    const pdfUrl = `/api/v1/billing/invoices/${realInvoiceId}/pdf`;

    const responsePayload = {
      _id: realInvoiceId,
      id: realInvoiceId,
      invoiceId: realInvoiceId,
      invoice_id: realInvoiceId,
      invoiceNumber: invNum,
      invoice_number: invNum,
      merchantId: (invoice && invoice.user_id) || (historyRec && historyRec.merchant_business_id) || 0,
      merchant_business_id: (invoice && invoice.user_id) || (historyRec && historyRec.merchant_business_id) || 0,
      merchantName: mName,
      merchant_name: mName,
      customerName: cName,
      customer_name: cName,
      customerEmail: cEmail,
      customer_email: cEmail,
      invoiceDate: invDate,
      invoice_date: invDate,
      created_at: invDate,
      paymentMode: pMode,
      payment_mode: pMode,
      paymentStatus: pStatus,
      payment_status: pStatus,
      shippingAddress: shipAddr,
      shipping_address: shipAddr,
      gst: numGst,
      tax_amount: numGst,
      discount: numDisc,
      discount_amount: numDisc,
      loyaltyPoints: loyaltyPts,
      loyalty_points: loyaltyPts,
      points_earned: loyaltyPts,
      items: formattedItems,
      purchased_items: formattedItems,
      subtotal: parseFloat((invoice && invoice.amount) || (historyRec && historyRec.subtotal) || 0),
      grand_total: parseFloat((invoice && invoice.total_amount) || (historyRec && historyRec.net_amount) || 0),
      total_amount: parseFloat((invoice && invoice.total_amount) || (historyRec && historyRec.net_amount) || 0),
      pdf_url: pdfUrl,
      pdfUrl: pdfUrl
    };

    console.log(`[FinancePlus Controller] ✅ Invoice loaded successfully for invoiceId: "${searchId}" (real ID: ${realInvoiceId}, items: ${formattedItems.length})`);
    return sendSuccess(res, responsePayload, 'Invoice loaded successfully');
  } catch (error) {
    console.error(`[FinancePlus Controller] ❌ Error in getInvoiceById for invoiceId "${searchId}":`, error);
    return sendError(res, 'Failed to fetch invoice details', 500);
=======
const getInvoiceDetails = async (req, res) => {
  try {
      const { id } = req.params; // business_invoices.id
      const userEmail = req.user.email ? String(req.user.email).trim().toLowerCase() : '';

      // Fetch invoice
      const invoice = await db.prepare('SELECT * FROM business_invoices WHERE id = ?').get(id);

      if (!invoice) return sendError(res, 'Invoice not found', 404);

      // Security: Ensure this customer is authorized to see this invoice
      if (!invoice.client_email || invoice.client_email.toLowerCase() !== userEmail) {
          return sendError(res, 'Unauthorized access to this invoice', 403);
      }

      // Fetch merchant details
      const merchant = await db.prepare('SELECT business_name, email FROM users WHERE id = ?').get(invoice.user_id);

      // Fetch payments
      const payments = await db.prepare('SELECT * FROM business_invoice_payments WHERE invoice_id = ?').all(id);

      // Loyalty Earned from this invoice
      const loyalty = await db.prepare('SELECT points FROM loyalty_transactions WHERE invoice_id = ? AND wallet_id = (SELECT id FROM loyalty_wallets WHERE user_id = ?)').get(id, req.user.id);

      if (invoice.items && typeof invoice.items === 'string') {
          try { invoice.items = JSON.parse(invoice.items); } catch (e) { invoice.items = []; }
      }

      return sendSuccess(res, {
          ...invoice,
          merchant: {
              name: merchant?.business_name || 'CLIKS Merchant',
              email: merchant?.email || 'N/A'
          },
          payments: Array.isArray(payments) ? payments : [],
          loyalty_earned: loyalty?.points || 0
      }, 'Invoice details loaded successfully');

  } catch (error) {
      console.error('[financePlusController] getInvoiceDetails error:', error);
      return sendError(res, 'Failed to fetch invoice details', 500);
>>>>>>> d86dbfd (purchase details updates)
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
<<<<<<< HEAD
  getCustomerPurchases, getLoyaltyStats, getInvoiceById
=======
  getCustomerPurchases, getLoyaltyStats, getInvoiceDetails
>>>>>>> d86dbfd (purchase details updates)
};
