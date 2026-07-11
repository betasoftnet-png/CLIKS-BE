const db = require('../db/connection');
const { sendSuccess } = require('../utils/response');

const getCalendar = async (req, res) => {
  const { from, to } = req.query;
  const uId = req.user.id;
  const events = [];

  // ── 1. Planned payments (pending) ──
  const paymentRows = db.prepare(
    `SELECT id, name AS title, description, amount, due_date AS date, 'payment' AS type
     FROM planned_payments
     WHERE user_id = ? AND status = 'pending'
       AND (due_date IS NOT NULL)
       ${from ? "AND due_date >= '" + from + "'" : ''}
       ${to   ? "AND due_date <= '" + to   + "'" : ''}`
  ).all(uId);
  paymentRows.forEach(r => events.push({ type: r.type, title: r.title || r.description || 'Payment', date: r.date, amount: r.amount, id: String(r.id), reference_id: String(r.id) }));

  // ── 2. Plan reminders (not sent) ──
  const planReminderRows = db.prepare(
    `SELECT pr.id, pr.title, pr.due_date AS date, pr.plan_id AS reference_id
     FROM plan_reminders pr
     WHERE pr.user_id = ?
       AND (pr.status IS NULL OR pr.status != 'sent')
       AND (pr.due_date IS NOT NULL)
       ${from ? "AND pr.due_date >= '" + from + "'" : ''}
       ${to   ? "AND pr.due_date <= '" + to   + "'" : ''}`
  ).all(uId);
  planReminderRows.forEach(r => events.push({ type: 'reminder', title: r.title, date: r.date, amount: null, id: String(r.id), reference_id: String(r.reference_id) }));

  // ── 3. People reminders (not sent) ──
  const peopleReminderRows = db.prepare(
    `SELECT r.id, r.title, r.due_date AS date, r.person_id AS reference_id, r.amount
     FROM people_reminders r
     WHERE r.user_id = ?
       AND (r.status IS NULL OR r.status != 'sent')
       AND (r.due_date IS NOT NULL)
       ${from ? "AND r.due_date >= '" + from + "'" : ''}
       ${to   ? "AND r.due_date <= '" + to   + "'" : ''}`
  ).all(uId);
  peopleReminderRows.forEach(r => events.push({ type: 'people_reminder', title: r.title, date: r.date, amount: r.amount || null, id: String(r.id), reference_id: String(r.reference_id) }));

  // ── 4. Debts with due_date ──
  const debtRows = db.prepare(
    `SELECT id, COALESCE(creditor_name, creditor) AS title, amount, due_date AS date
     FROM debts
     WHERE user_id = ? AND due_date IS NOT NULL
       ${from ? "AND due_date >= '" + from + "'" : ''}
       ${to   ? "AND due_date <= '" + to   + "'" : ''}`
  ).all(uId);
  debtRows.forEach(r => events.push({ type: 'debt_due', title: r.title || 'Debt due', date: r.date, amount: r.amount, id: String(r.id), reference_id: String(r.id) }));

  // ── 5. Savings with deadline ──
  const savingRows = db.prepare(
    `SELECT id, name AS title, target_amount AS amount, deadline AS date
     FROM savings
     WHERE user_id = ? AND deadline IS NOT NULL
       ${from ? "AND deadline >= '" + from + "'" : ''}
       ${to   ? "AND deadline <= '" + to   + "'" : ''}`
  ).all(uId);
  savingRows.forEach(r => events.push({ type: 'savings_deadline', title: r.title || 'Savings goal', date: r.date, amount: r.amount, id: String(r.id), reference_id: String(r.id) }));

  // ── 6. Plan goals with deadline (not achieved) ──
  const goalRows = db.prepare(
    `SELECT id, COALESCE(title, name) AS title, target_amount AS amount, deadline AS date, plan_id AS reference_id
     FROM plan_goals
     WHERE user_id = ? AND deadline IS NOT NULL AND (status IS NULL OR status != 'achieved')
       ${from ? "AND deadline >= '" + from + "'" : ''}
       ${to   ? "AND deadline <= '" + to   + "'" : ''}`
  ).all(uId);
  goalRows.forEach(r => events.push({ type: 'goal_deadline', title: r.title || 'Goal', date: r.date, amount: r.amount, id: String(r.id), reference_id: String(r.reference_id) }));

  // Sort all events by date ASC, nulls last
  events.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(a.date) - new Date(b.date);
  });

  return sendSuccess(res, events, 'Financial calendar fetched');
};

module.exports = { getCalendar };
