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

// ── Notifications ─────────────────────────────────────────────────────────────
const getNotifications = async (req, res) => {
  const list = await db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  return sendSuccess(res, list);
};

const markNotificationRead = async (req, res) => {
  await db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  return sendSuccess(res, null, 'Marked as read');
};

// ── Role-Based Settings ───────────────────────────────────────────────────────
const updatePrimaryIncomeSource = async (req, res) => {
  const { source } = req.body;
  await db.prepare('UPDATE users SET primary_income_source = ?, updated_at = ? WHERE id = ?')
    .run(source, new Date().toISOString(), req.user.id);
  return sendSuccess(res, null, 'Income source preference updated');
};

module.exports = {
  getGoals, createGoal, updateGoal, deleteGoal,
  getSalaryRecords, createSalaryRecord,
  getPropertyRecords, createProperty, recordRentReceived,
  getPensionRecords, recordPension,
  getTaxRecords, saveTaxRecord,
  getNotifications, markNotificationRead,
  updatePrimaryIncomeSource
};
