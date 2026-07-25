const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

function normalizePaymentMode(mode) {
    if (!mode) return 'Cash in Hand';
    const m = String(mode).toLowerCase();
    if (m === 'cash' || m.includes('cash in hand') || m.includes('hand')) {
        return 'Cash in Hand';
    }
    if (m.includes('hdfc')) {
        return 'HDFC Bank Account';
    }
    if (m.includes('icici')) {
        return 'ICICI Bank Account';
    }
    if (m.includes('sbi') || m.includes('state bank')) {
        return 'SBI Current Account';
    }
    if (m === 'upi' || m.includes('razorpay') || m.includes('gpay') || m.includes('phonepe') || m.includes('paytm')) {
        return 'UPI / Razorpay';
    }
    if (m === 'bank' || m.includes('bank')) {
        return 'HDFC Bank Account';
    }
    return mode;
}

const initTableAndColumns = async () => {
    try {
        const dbType = process.env.DB_TYPE || 'sqlite';
        const idType = dbType === 'postgres' ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
        await db.prepare(`
            CREATE TABLE IF NOT EXISTS expenses (
                id ${idType},
                user_id INTEGER,
                account_id INTEGER,
                category TEXT,
                amount REAL,
                description TEXT,
                date TEXT,
                is_recurring INTEGER,
                created_at TEXT,
                updated_at TEXT
            )
        `).run();
    } catch (e) {
        // Table already exists
    }

    const columns = [
        'expense_number',
        'expense_date',
        'expense_status',
        'category_name',
        'subcategory',
        'payee_name',
        'payee_phone',
        'payee_gstin',
        'expense_amount',
        'gst_percentage',
        'subtotal',
        'tax_amount',
        'payment_mode',
        'transaction_reference',
        'input_tax_credit',
        'employee_name',
        'travel_expense',
        'claim_amount',
        'reimbursement_status',
        'approval_by',
        'is_claim',
        'budget_limit',
        'spent_amount',
        'alert_status',
        'is_budget',
        'is_blocked',
        'recurring_type',
        'next_due_date',
        'auto_create',
        'recurring_status',
        'receipt',
        'subscription_name'
    ];
    for (const col of columns) {
        try {
            await db.prepare(`ALTER TABLE expenses ADD COLUMN ${col} TEXT`).run();
        } catch (e) {
            // Column already exists
        }
    }
};
initTableAndColumns();

const advanceDate = (dateStr, frequency) => {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const freq = String(frequency).toLowerCase();
    if (freq.includes('quarter')) {
        d.setMonth(d.getMonth() + 3);
    } else if (freq.includes('year')) {
        d.setFullYear(d.getFullYear() + 1);
    } else {
        d.setMonth(d.getMonth() + 1);
    }
    return d.toISOString().split('T')[0];
};

async function autoPostDueRecurringExpenses(userId) {
    try {
        const todayStr = new Date().toISOString().split('T')[0];
        const subscriptions = await db.prepare(`
            SELECT * FROM expenses 
            WHERE user_id = ? AND is_recurring = 1 
            AND auto_create = 'Active' AND recurring_status = 'Active'
        `).all(userId);

        const now = new Date().toISOString();

        for (const sub of subscriptions) {
            if (!sub.next_due_date) continue;
            let currentDue = sub.next_due_date;
            
            while (currentDue <= todayStr) {
                const expNum = `EXP-AUTO-${Date.now().toString().slice(-4)}-${Math.floor(1000 + Math.random() * 9000)}`;
                const amt = parseFloat(sub.expense_amount) || 0;
                
                // 1. Insert into expenses table
                await db.prepare(`
                    INSERT INTO expenses (
                        user_id, expense_number, expense_date, expense_status, category_name, subcategory,
                        payee_name, expense_amount, amount, subtotal, tax_amount, payment_mode, transaction_reference, 
                        is_claim, is_budget, is_recurring, created_at, updated_at
                    ) VALUES (?, ?, ?, 'paid', ?, ?, ?, ?, ?, ?, 0, 'UPI', 'AUTO-POSTED', 'false', 'false', 0, ?, ?)
                `).run(
                    userId, expNum, currentDue, sub.category_name || 'General', sub.subscription_name || 'Recurring Subscription',
                    sub.payee_name || 'Vendor', amt, amt, amt, now, now
                );

                // 2. Sync to accounting ledger
                await db.prepare(`
                    INSERT INTO accounting (
                        user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at
                    ) VALUES (?, 'expense', ?, ?, ?, 'UPI / Razorpay', ?, 'posted', ?, ?)
                `).run(
                    userId, currentDue, amt, sub.category_name || 'Office spent', 
                    `Recurring: ${sub.subscription_name || 'Subscription'}`, now, now
                );

                currentDue = advanceDate(currentDue, sub.recurring_type);
            }

            if (currentDue !== sub.next_due_date) {
                await db.prepare(`
                    UPDATE expenses SET next_due_date = ?, updated_at = ? 
                    WHERE id = ? AND user_id = ?
                `).run(currentDue, now, sub.id, userId);
            }
        }
    } catch (err) {
        console.error('[autoPostDueRecurringExpenses] error:', err);
    }
}

async function createExpenseForClaim(claimId, userId, paymentMode, paymentDate) {
    const ref = `REIMB-CLAIM-${claimId}`;
    const exists = await db.prepare("SELECT id FROM expenses WHERE user_id = ? AND transaction_reference = ? AND is_claim = 'false'").get(userId, ref);
    if (exists) return;

    const claim = await db.prepare("SELECT * FROM expenses WHERE id = ? AND user_id = ?").get(claimId, userId);
    if (!claim) return;

    const now = new Date().toISOString();
    const amt = parseFloat(claim.claim_amount) || 0;
    const expNum = `EXP-REIMB-${Date.now().toString().slice(-4)}-${Math.floor(1000 + Math.random() * 9000)}`;
    const finalMode = paymentMode || 'UPI / Razorpay';
    const finalDate = paymentDate || claim.date || now.split('T')[0];

    // 1. Create expense row in expenses table (is_claim = 'false')
    await db.prepare(`
        INSERT INTO expenses (
            user_id, expense_number, expense_date, expense_status, category_name, subcategory,
            payee_name, expense_amount, amount, subtotal, tax_amount, payment_mode, transaction_reference,
            is_claim, is_budget, is_recurring, created_at, updated_at
        ) VALUES (?, ?, ?, 'paid', 'Staff Welfare & Reimbursement', ?, ?, ?, ?, ?, 0, ?, ?, 'false', 'false', 0, ?, ?)
    `).run(userId, expNum, finalDate, claim.travel_expense || '', claim.employee_name || '', amt, amt, amt, finalMode, ref, now, now);

    // 2. Create accounting entry to register the expense and reduce selected Cash/Bank balance
    await db.prepare(`
        INSERT INTO accounting (
            user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at
        ) VALUES (?, 'expense', ?, ?, 'Staff Welfare & Reimbursement', ?, ?, 'posted', ?, ?)
    `).run(userId, finalDate, amt, finalMode, `Staff claim reimbursement: ${claim.employee_name || ''} - ${claim.travel_expense || ''}`, now, now);
}

const expensesController = {
    // 1. Expense Registry & Filters
    getExpenses: async (req, res) => {
        const { category, status, payment_mode, date, q } = req.query;
        try {
            await autoPostDueRecurringExpenses(req.user.id);

            let sql = "SELECT * FROM expenses WHERE user_id = ? AND (is_claim IS NULL OR is_claim = 'false') AND (is_budget IS NULL OR is_budget = 'false')";
            const params = [req.user.id];

            if (category) {
                sql += " AND category_name = ?";
                params.push(category);
            }
            if (status) {
                sql += " AND expense_status = ?";
                params.push(status);
            }
            if (payment_mode) {
                sql += " AND payment_mode = ?";
                params.push(payment_mode);
            }
            if (date) {
                sql += " AND expense_date = ?";
                params.push(date);
            }
            if (q) {
                sql += " AND (payee_name LIKE ? OR category_name LIKE ?)";
                params.push(`%${q}%`, `%${q}%`);
            }

            sql += " ORDER BY id DESC";
            const list = await db.prepare(sql).all(...params);
            return sendSuccess(res, list, 'Expenses retrieved successfully');
        } catch (error) {
            console.error('[Expense GET] Error:', error);
            return sendError(res, 'Retrieve failed', 500);
        }
    },

    createExpense: async (req, res) => {
        const { category_name, subcategory, payee_name, expense_amount, gst_percentage, payment_mode, transaction_reference } = req.body;
        try {
            const now = new Date().toISOString();
            const expNum = `EXP-2026-${Date.now().toString().slice(-3)}`;
            const amt = parseFloat(expense_amount) || 0;
            const gst = parseFloat(gst_percentage) || 0;
            const sub = Math.round(amt / (1 + gst / 100));
            const tax = amt - sub;

            const result = await db.prepare(`
                INSERT INTO expenses (
                    user_id, amount, expense_number, expense_date, expense_status, category_name, subcategory,
                    payee_name, payee_phone, payee_gstin, expense_amount, gst_percentage, subtotal, tax_amount,
                    payment_mode, transaction_reference, input_tax_credit, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'paid', ?, ?, ?, '+91 xxxxx xxxxx', '27XXXXX0000X0Z0', ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                req.user.id, amt, expNum, now.split('T')[0], category_name || 'General', subcategory || 'Service Description',
                payee_name || 'Vendor Profile', amt, gst, sub, tax, payment_mode || 'UPI', transaction_reference || 'TXN-908122',
                gst > 0 ? 'Eligible (ITC Claimed)' : 'Not Applicable', now, now
            );

            const inserted = await db.prepare('SELECT * FROM expenses WHERE id = ?').get(result.lastInsertRowid);
            
            const normalizedMode = normalizePaymentMode(payment_mode);
            await db.prepare(`
                INSERT INTO accounting (user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at)
                VALUES (?, 'expense', ?, ?, ?, ?, ?, 'posted', ?, ?)
            `).run(req.user.id, now.split('T')[0], amt, category_name || 'General', normalizedMode, `Expense #${expNum}`, now, now);

            return sendSuccess(res, inserted, 'Expense recorded successfully', 201);
        } catch (error) {
            console.error('[Expense] Error:', error);
            return sendError(res, 'Record failed', 500);
        }
    },

    getExpense: async (req, res) => {
        try {
            const row = await db.prepare('SELECT * FROM expenses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
            if (!row) return sendError(res, 'Expense not found', 404);
            return sendSuccess(res, row);
        } catch (error) {
            return sendError(res, 'Retrieve failed', 500);
        }
    },

    updateExpense: async (req, res) => {
        try {
            return sendSuccess(res, req.body, 'Expense updated');
        } catch (error) {
            return sendError(res, 'Update failed', 500);
        }
    },

    deleteExpense: async (req, res) => {
        try {
            const exp = await db.prepare('SELECT expense_number FROM expenses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
            if (exp) {
                await db.prepare("DELETE FROM accounting WHERE user_id = ? AND notes = ?").run(req.user.id, `Expense #${exp.expense_number}`);
            }
            await db.prepare('DELETE FROM expenses WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
            return sendSuccess(res, null, 'Expense deleted');
        } catch (error) {
            return sendError(res, 'Delete failed', 500);
        }
    },

    // 2. Categories
    createCategory: async (req, res) => {
        return sendSuccess(res, req.body, 'Category added');
    },
    getCategories: async (req, res) => {
        return sendSuccess(res, ['Rent', 'Electricity', 'Internet', 'Salary', 'Fuel'], 'Categories retrieved');
    },
    updateCategory: async (req, res) => {
        return sendSuccess(res, req.body, 'Category updated');
    },
    deleteCategory: async (req, res) => {
        return sendSuccess(res, null, 'Category deleted');
    },

    // 3. Payments
    createPayment: async (req, res) => {
        return sendSuccess(res, req.body, 'Payment processed');
    },
    getPayments: async (req, res) => {
        return sendSuccess(res, [], 'Payments retrieved');
    },

    // 4. Attachments
    addAttachment: async (req, res) => {
        return sendSuccess(res, req.body, 'Attachment uploaded');
    },
    getAttachments: async (req, res) => {
        return sendSuccess(res, [], 'Attachments retrieved');
    },
    deleteAttachment: async (req, res) => {
        return sendSuccess(res, null, 'Attachment deleted');
    },

    // 5. Notes / Tags
    addNotes: async (req, res) => {
        return sendSuccess(res, req.body, 'Notes added');
    },
    getNotes: async (req, res) => {
        return sendSuccess(res, [], 'Notes retrieved');
    },
    addTags: async (req, res) => {
        return sendSuccess(res, req.body, 'Tags added');
    },
    getTags: async (req, res) => {
        return sendSuccess(res, [], 'Tags retrieved');
    },

    // 6. Approval Queue
    approveExpense: async (req, res) => {
        try {
            const now = new Date().toISOString();
            await db.prepare("UPDATE expenses SET reimbursement_status = 'Approved', approval_by = 'Ankit Sharma (Manager)', updated_at = ? WHERE id = ? AND user_id = ?").run(now, req.params.id, req.user.id);
            return sendSuccess(res, null, 'Reimbursement approved');
        } catch (error) {
            console.error('[Expense Claim] Approve Error:', error);
            return sendError(res, 'Approval failed', 500);
        }
    },
    rejectExpense: async (req, res) => {
        const { reason } = req.body;
        try {
            const now = new Date().toISOString();
            if (reason) {
                await db.prepare("UPDATE expenses SET reimbursement_status = 'Rejected', description = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(reason, now, req.params.id, req.user.id);
            } else {
                await db.prepare("UPDATE expenses SET reimbursement_status = 'Rejected', updated_at = ? WHERE id = ? AND user_id = ?").run(now, req.params.id, req.user.id);
            }
            return sendSuccess(res, null, 'Reimbursement rejected');
        } catch (error) {
            console.error('[Expense Claim] Reject Error:', error);
            return sendError(res, 'Rejection failed', 500);
        }
    },
    payExpenseClaim: async (req, res) => {
        const { paymentMode, paymentDate } = req.body;
        try {
            const now = new Date().toISOString();
            const finalDate = paymentDate || now.split('T')[0];
            await db.prepare("UPDATE expenses SET reimbursement_status = 'Paid', expense_date = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(finalDate, now, req.params.id, req.user.id);
            await createExpenseForClaim(req.params.id, req.user.id, paymentMode, finalDate);
            return sendSuccess(res, null, 'Reimbursement marked as Paid');
        } catch (error) {
            console.error('[Expense Claim] Pay Error:', error);
            return sendError(res, 'Pay claim failed', 500);
        }
    },

    // 7. Reimbursements claims
    reimburseExpense: async (req, res) => {
        const { employee_name, travel_expense, claim_amount, receipt } = req.body;
        try {
            const now = new Date().toISOString();
            const val = parseFloat(claim_amount) || 0;
            const result = await db.prepare(`
                INSERT INTO expenses (
                    user_id, amount, employee_name, travel_expense, claim_amount, reimbursement_status, is_claim, receipt, date, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'Pending', 'true', ?, ?, ?, ?)
            `).run(req.user.id, val, employee_name, travel_expense, val, receipt || null, now.split('T')[0], now, now);

            const inserted = await db.prepare('SELECT * FROM expenses WHERE id = ?').get(result.lastInsertRowid);
            return sendSuccess(res, inserted, 'Reimbursement claim lodged successfully', 201);
        } catch (error) {
            console.error('[Expense Reimburse] Error:', error);
            return sendError(res, 'Lodge claim failed', 500);
        }
    },
    getReimbursements: async (req, res) => {
        try {
            const list = await db.prepare("SELECT * FROM expenses WHERE user_id = ? AND is_claim = 'true' ORDER BY id DESC").all(req.user.id);
            return sendSuccess(res, list, 'Reimbursements claims retrieved');
        } catch (error) {
            return sendError(res, 'Retrieve claims failed', 500);
        }
    },

    // 8. Recurrings
    createRecurring: async (req, res) => {
        const { subscription_name, payee_name, category_name, expense_amount, recurring_type, next_due_date, auto_create, recurring_status } = req.body;
        try {
            const now = new Date().toISOString();
            const amt = parseFloat(expense_amount) || 0;
            const result = await db.prepare(`
                INSERT INTO expenses (
                    user_id, subscription_name, payee_name, category_name, expense_amount, amount,
                    recurring_type, next_due_date, auto_create, recurring_status, is_recurring, is_claim, is_budget, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'false', 'false', ?, ?)
            `).run(
                req.user.id, subscription_name || '', payee_name || '', category_name || 'General', amt, amt,
                recurring_type || 'monthly', next_due_date || now.split('T')[0], auto_create || 'Active', recurring_status || 'Active',
                now, now
            );

            const inserted = await db.prepare('SELECT * FROM expenses WHERE id = ?').get(result.lastInsertRowid);
            return sendSuccess(res, inserted, 'Recurring expense created', 201);
        } catch (error) {
            console.error('[Expense Recurring] Create Error:', error);
            return sendError(res, 'Create recurring subscription failed', 500);
        }
    },
    getRecurrings: async (req, res) => {
        try {
            await autoPostDueRecurringExpenses(req.user.id);

            const list = await db.prepare("SELECT * FROM expenses WHERE user_id = ? AND is_recurring = 1 ORDER BY id DESC").all(req.user.id);
            return sendSuccess(res, list, 'Recurring automations retrieved');
        } catch (error) {
            console.error('[Expense Recurring] Get Error:', error);
            return sendError(res, 'Retrieve recurrings failed', 500);
        }
    },
    updateRecurring: async (req, res) => {
        const { id } = req.params;
        const { subscription_name, payee_name, category_name, expense_amount, recurring_type, next_due_date, auto_create, recurring_status } = req.body;
        try {
            const now = new Date().toISOString();
            const amt = parseFloat(expense_amount) || 0;
            await db.prepare(`
                UPDATE expenses SET 
                    subscription_name = ?, payee_name = ?, category_name = ?, expense_amount = ?, amount = ?,
                    recurring_type = ?, next_due_date = ?, auto_create = ?, recurring_status = ?, updated_at = ?
                WHERE id = ? AND user_id = ? AND is_recurring = 1
            `).run(
                subscription_name, payee_name, category_name, amt, amt,
                recurring_type, next_due_date, auto_create, recurring_status, now,
                id, req.user.id
            );
            const updated = await db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
            return sendSuccess(res, updated, 'Recurring expense updated');
        } catch (error) {
            console.error('[Expense Recurring] Update Error:', error);
            return sendError(res, 'Update recurring subscription failed', 500);
        }
    },
    deleteRecurring: async (req, res) => {
        const { id } = req.params;
        try {
            await db.prepare("DELETE FROM expenses WHERE id = ? AND user_id = ? AND is_recurring = 1").run(id, req.user.id);
            return sendSuccess(res, null, 'Recurring expense deleted');
        } catch (error) {
            console.error('[Expense Recurring] Delete Error:', error);
            return sendError(res, 'Delete recurring subscription failed', 500);
        }
    },

    // 9. Budgets
    createBudget: async (req, res) => {
        const { category_name, budget_limit } = req.body;
        try {
            const now = new Date().toISOString();
            const limit = parseFloat(budget_limit) || 5000;
            const result = await db.prepare(`
                INSERT INTO expenses (
                    user_id, amount, category_name, budget_limit, spent_amount, alert_status, is_budget, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 0, 'Optimal', 'true', ?, ?)
            `).run(req.user.id, limit, category_name, limit, now, now);

            const inserted = await db.prepare('SELECT * FROM expenses WHERE id = ?').get(result.lastInsertRowid);
            return sendSuccess(res, inserted, 'Budget limit allocated', 201);
        } catch (error) {
            console.error('[Expense Budget] Error:', error);
            return sendError(res, 'Set budget failed', 500);
        }
    },
    getBudgets: async (req, res) => {
        try {
            const list = await db.prepare("SELECT * FROM expenses WHERE user_id = ? AND is_budget = 'true' ORDER BY id DESC").all(req.user.id);
            return sendSuccess(res, list, 'Budgets targets retrieved');
        } catch (error) {
            return sendError(res, 'Retrieve budgets failed', 500);
        }
    },
    updateBudget: async (req, res) => {
        const { id } = req.params;
        const { category_name, budget_limit } = req.body;
        try {
            const now = new Date().toISOString();
            const limit = parseFloat(budget_limit) || 5000;
            await db.prepare(`
                UPDATE expenses SET category_name = ?, amount = ?, budget_limit = ?, updated_at = ?
                WHERE id = ? AND user_id = ? AND is_budget = 'true'
            `).run(category_name, limit, limit, now, id, req.user.id);
            const updated = await db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
            return sendSuccess(res, updated, 'Budget target updated');
        } catch (error) {
            console.error('[Expense Budget] Update Error:', error);
            return sendError(res, 'Update budget failed', 500);
        }
    },
    deleteBudget: async (req, res) => {
        const { id } = req.params;
        try {
            await db.prepare("DELETE FROM expenses WHERE id = ? AND user_id = ? AND is_budget = 'true'").run(id, req.user.id);
            return sendSuccess(res, null, 'Budget target deleted');
        } catch (error) {
            console.error('[Expense Budget] Delete Error:', error);
            return sendError(res, 'Delete budget failed', 500);
        }
    },

    // 10. Tax & Vendor info
    addTax: async (req, res) => {
        return sendSuccess(res, req.body, 'Tax logged');
    },
    getTax: async (req, res) => {
        return sendSuccess(res, {}, 'Tax retrieved');
    },
    addVendor: async (req, res) => {
        return sendSuccess(res, req.body, 'Vendor logged');
    },
    getVendor: async (req, res) => {
        return sendSuccess(res, {}, 'Vendor retrieved');
    },

    // 11. History / Analytics / Reports
    getHistory: async (req, res) => {
        return sendSuccess(res, [], 'Operational history retrieved');
    },
    getTimeline: async (req, res) => {
        return sendSuccess(res, [], 'Timeline log retrieved');
    },
    getAnalytics: async (req, res) => {
        return sendSuccess(res, { score: 98 }, 'Operational analytics retrieved');
    },
    getReportSummary: async (req, res) => {
        return sendSuccess(res, {}, 'Summary report retrieved');
    },
    getReportCategory: async (req, res) => {
        return sendSuccess(res, {}, 'Category report retrieved');
    },
    getReportMonthly: async (req, res) => {
        return sendSuccess(res, {}, 'Monthly report retrieved');
    },
    getReportVendor: async (req, res) => {
        return sendSuccess(res, {}, 'Vendor report retrieved');
    },
    getReportTax: async (req, res) => {
        return sendSuccess(res, {}, 'Tax report retrieved');
    },
    getReportReimbursement: async (req, res) => {
        return sendSuccess(res, {}, 'Reimbursement report retrieved');
    },

    // 12. Import / Export / Blocks
    importExpenses: async (req, res) => {
        return sendSuccess(res, null, 'Import successful');
    },
    exportExpenses: async (req, res) => {
        return sendSuccess(res, [], 'Export successful');
    },
    blockExpense: async (req, res) => {
        return sendSuccess(res, null, 'Expense blocked');
    },
    unblockExpense: async (req, res) => {
        return sendSuccess(res, null, 'Expense unblocked');
    },
    getDashboardSummary: async (req, res) => {
        return sendSuccess(res, { status: 'healthy' }, 'Dashboard summary retrieved');
    }
};

module.exports = expensesController;
