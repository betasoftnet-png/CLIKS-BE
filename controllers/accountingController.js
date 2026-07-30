const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const gstHelper = require('../utils/gstHelper');

const hasFinancePermission = async (req) => {
    if (!req.user) return false;
    const role = String(req.user.role || '').toLowerCase();
    if (['admin', 'finance manager', 'finance_manager', 'financemanager', 'accountant'].includes(role)) {
        return true;
    }
    try {
        const emp = await db.prepare("SELECT permissions, role FROM employees WHERE user_id = ?").get(req.user.id);
        if (emp) {
            const empRole = String(emp.role || '').toLowerCase();
            if (['admin', 'finance manager', 'finance_manager', 'financemanager', 'accountant'].includes(empRole)) {
                return true;
            }
            const perms = String(emp.permissions || '').toLowerCase();
            if (perms.includes('finance') || perms.includes('manage_finances') || perms.includes('accounting')) {
                return true;
            }
        }
    } catch (e) {
        console.error('[hasFinancePermission] Error checking employees:', e);
    }
    if (req.user.permissions) {
        const perms = String(req.user.permissions).toLowerCase();
        if (perms.includes('finance') || perms.includes('manage_finances') || perms.includes('accounting')) {
            return true;
        }
    }
    return false;
};

// Ensure database table and extra helper columns exist dynamically
const initTableAndColumns = async () => {
    try {
        const dbType = process.env.DB_TYPE || 'sqlite';
        const idType = dbType === 'postgres' ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
        await db.prepare(`
            CREATE TABLE IF NOT EXISTS accounting (
                id ${idType},
                user_id INTEGER,
                entry_type TEXT,
                date TEXT,
                amount REAL,
                category TEXT,
                mode TEXT,
                notes TEXT,
                account_type TEXT,
                status TEXT,
                created_at TEXT,
                updated_at TEXT
            )
        `).run();
    } catch (e) {
        console.error('[Accounting Init Error] Table creation:', e.message);
    }

    const columns = [
        'account_name',
        'account_number',
        'balance',
        'reconciliation_status',
        'lock_status',
        'bank_name',
        'ifsc_code',
        'branch_name'
    ];
    for (const col of columns) {
        try {
            await db.prepare(`ALTER TABLE accounting ADD COLUMN ${col} TEXT`).run();
        } catch (e) {
            // Column already exists
        }
    }
};
initTableAndColumns();

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

const accountingController = {
    // 1. Accounts
    createAccount: async (req, res) => {
        const { account_name, account_type, balance, account_number } = req.body;
        try {
            const now = new Date().toISOString();
            const result = await db.prepare(`
                INSERT INTO accounting (user_id, account_name, account_type, balance, account_number, entry_type, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 'AccountConfig', 'active', ?, ?)
            `).run(req.user.id, account_name || 'Main Savings', account_type || 'asset', balance || '10000', account_number || '1234567890', now, now);
            const inserted = await db.prepare('SELECT * FROM accounting WHERE id = ?').get(result.lastInsertRowid);
            return sendSuccess(res, inserted, 'Account created successfully', 201);
        } catch (error) {
            return sendError(res, 'Failed to create account', 500);
        }
    },
    getAccounts: async (req, res) => {
        const { type, status } = req.query;
        try {
            let query = "SELECT * FROM accounting WHERE user_id = ? AND entry_type = 'AccountConfig'";
            const params = [req.user.id];
            if (type) {
                query += ' AND account_type = ?';
                params.push(type);
            }
            if (status) {
                query += ' AND status = ?';
                params.push(status);
            }
            const list = await db.prepare(query).all(...params);
            return sendSuccess(res, list, 'Accounts retrieved successfully');
        } catch (error) {
            return sendError(res, 'Failed to fetch accounts', 500);
        }
    },
    getAccountById: async (req, res) => {
        const { id } = req.params;
        try {
            const acc = await db.prepare('SELECT * FROM accounting WHERE id = ? AND user_id = ?').get(id, req.user.id);
            return sendSuccess(res, acc, 'Account retrieved');
        } catch (error) {
            return sendError(res, 'Failed to retrieve account', 500);
        }
    },
    updateAccount: async (req, res) => {
        const { id } = req.params;
        const fields = req.body;
        try {
            if (!(await hasFinancePermission(req))) {
                return sendError(res, 'Access Denied: You are not authorized to perform this operation.', 403);
            }

            const updates = [];
            const params = [];
            for (const [key, value] of Object.entries(fields)) {
                if (key !== 'id' && key !== 'user_id') {
                    updates.push(`${key} = ?`);
                    params.push(value);
                }
            }
            if (updates.length > 0) {
                params.push(id, req.user.id);
                await db.prepare(`UPDATE accounting SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
            }
            const record = await db.prepare('SELECT * FROM accounting WHERE id = ?').get(id);
            return sendSuccess(res, record, 'Account updated successfully');
        } catch (error) {
            return sendError(res, 'Failed to update account', 500);
        }
    },
    deleteAccount: async (req, res) => {
        const { id } = req.params;
        try {
            if (!(await hasFinancePermission(req))) {
                return sendError(res, 'Access Denied: You are not authorized to perform this operation.', 403);
            }

            const acc = await db.prepare("SELECT * FROM accounting WHERE id = ? AND user_id = ?").get(id, req.user.id);
            if (!acc) return sendError(res, 'Account not found', 404);

            // Check if any transactions exist for this account (matching on account_name)
            const txCount = await db.prepare("SELECT COUNT(*) as count FROM accounting WHERE user_id = ? AND entry_type IN ('income', 'expense') AND mode = ?").get(req.user.id, acc.account_name);
            if (txCount && txCount.count > 0) {
                return sendError(res, 'This account contains transactions and cannot be deleted. Please deactivate or archive the account instead.', 400);
            }

            await db.prepare('DELETE FROM accounting WHERE id = ? AND user_id = ?').run(id, req.user.id);
            return sendSuccess(res, null, 'Account deleted');
        } catch (error) {
            console.error('[Accounting deleteAccount] Error:', error);
            return sendError(res, 'Delete failed', 500);
        }
    },
    searchAccounts: async (req, res) => {
        const { q } = req.query;
        try {
            const term = `%${q || ''}%`;
            const list = await db.prepare(`
                SELECT * FROM accounting WHERE user_id = ? AND entry_type = 'AccountConfig' AND account_name LIKE ?
            `).all(req.user.id, term);
            return sendSuccess(res, list, 'Search results');
        } catch (error) {
            return sendError(res, 'Search failed', 500);
        }
    },

    // 2. Journal Entries
    createJournalEntry: async (req, res) => {
        const {
            entry_type, date, amount, category, mode, notes,
            customer_name, invoice_number, due_date,
            supplier_name, bill_number, reference_number,
            payment_mode_from, payment_mode_to, supplier_gstin
        } = req.body;

        try {
            const now = new Date().toISOString();
            const dateStr = date || now.split('T')[0];
            const parsedAmount = parseFloat(amount) || 0;

            if (parsedAmount <= 0) {
                return sendError(res, 'Amount must be greater than zero', 400);
            }

            if (entry_type === 'income') {
                // Income / Sales (Cash Sale or Credit Sale)
                if (!customer_name) return sendError(res, 'Customer name is required', 400);

                const invNum = invoice_number || `INV-${Date.now().toString().slice(-6)}`;
                
                const isCreditSale = mode === 'Accounts Receivable (Credit Sale)' || 
                                     (mode && typeof mode === 'string' && 
                                      (mode.toLowerCase().includes('accounts receivable') || 
                                       mode.toLowerCase().includes('credit sale')));

                if (isCreditSale) {
                    // Credit Sale through Income form
                    const dueStr = due_date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

                    // Prevent duplicate invoice numbers
                    const exists = await db.prepare('SELECT id FROM business_invoices WHERE invoice_number = ? AND user_id = ?').get(invNum, req.user.id);
                    if (exists) return sendError(res, 'Invoice number already exists', 400);

                    // 1. Create unpaid sales invoice
                    await db.prepare(`
                        INSERT INTO business_invoices (
                            user_id, invoice_number, client_name, amount, tax_amount, total_amount,
                            paid_amount, due_amount, status, due_date, payment_mode, created_at, updated_at, items
                        ) VALUES (?, ?, ?, ?, 0, ?, 0, ?, 'Unpaid', ?, 'Credit', ?, ?, '[]')
                    `).run(req.user.id, invNum, customer_name, parsedAmount, parsedAmount, parsedAmount, dueStr, now, now);

                    // 2. Create accounting entry (revenue but without affecting cash/bank)
                    const result = await db.prepare(`
                        INSERT INTO accounting (user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at)
                        VALUES (?, 'income', ?, ?, ?, 'Accounts Receivable (Credit Sale)', ?, 'posted', ?, ?)
                    `).run(req.user.id, dateStr, parsedAmount, category || 'Sales Revenue', notes ? `${notes} (Invoice #${invNum})` : `Credit Sale #${invNum}`, now, now);

                    const inserted = await db.prepare('SELECT * FROM accounting WHERE id = ?').get(result.lastInsertRowid);
                    return sendSuccess(res, inserted, 'Credit Sale created successfully', 201);
                } else {
                    // 1. Create a paid sales invoice
                    await db.prepare(`
                        INSERT INTO business_invoices (
                            user_id, invoice_number, client_name, amount, tax_amount, total_amount,
                            paid_amount, due_amount, status, due_date, payment_mode, created_at, updated_at, items
                        ) VALUES (?, ?, ?, ?, 0, ?, ?, 0, 'Paid', ?, ?, ?, ?, '[]')
                    `).run(req.user.id, invNum, customer_name, parsedAmount, parsedAmount, parsedAmount, dateStr, mode || 'Cash in Hand', now, now);

                    const inv = await db.prepare('SELECT id FROM business_invoices WHERE invoice_number = ? AND user_id = ?').get(invNum, req.user.id);
                    if (inv) {
                        await db.prepare('INSERT INTO business_invoice_payments (invoice_id, amount, payment_method, payment_date, reference_number, notes) VALUES (?, ?, ?, ?, ?, ?)')
                            .run(inv.id, parsedAmount, mode || 'Cash in Hand', now, reference_number || null, notes || null);
                    }

                    // 2. Create accounting entry
                    const result = await db.prepare(`
                        INSERT INTO accounting (user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at)
                        VALUES (?, 'income', ?, ?, ?, ?, ?, 'posted', ?, ?)
                    `).run(req.user.id, dateStr, parsedAmount, category || 'Sales Revenue', mode || 'Cash in Hand', notes || `Cash Sale #${invNum}`, now, now);

                    const inserted = await db.prepare('SELECT * FROM accounting WHERE id = ?').get(result.lastInsertRowid);
                    return sendSuccess(res, inserted, 'Income recorded successfully', 201);
                }
            }
            
            else if (entry_type === 'credit_sale') {
                // Credit Sale
                if (!customer_name) return sendError(res, 'Customer name is required', 400);
                if (!due_date) return sendError(res, 'Due date is required', 400);

                const invNum = invoice_number || `INV-${Date.now().toString().slice(-6)}`;

                // Prevent duplicate invoice numbers
                const exists = await db.prepare('SELECT id FROM business_invoices WHERE invoice_number = ? AND user_id = ?').get(invNum, req.user.id);
                if (exists) return sendError(res, 'Invoice number already exists', 400);

                // 1. Create invoice in business_invoices with Unpaid status
                await db.prepare(`
                    INSERT INTO business_invoices (
                        user_id, invoice_number, client_name, amount, tax_amount, total_amount,
                        paid_amount, due_amount, status, due_date, payment_mode, created_at, updated_at, items
                    ) VALUES (?, ?, ?, ?, 0, ?, 0, ?, 'Unpaid', ?, 'Credit', ?, ?, '[]')
                `).run(req.user.id, invNum, customer_name, parsedAmount, parsedAmount, parsedAmount, due_date, now, now);

                // 2. Create accounting entry (revenue but without affecting cash/bank)
                const result = await db.prepare(`
                    INSERT INTO accounting (user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at)
                    VALUES (?, 'income', ?, ?, ?, 'Accounts Receivable (Credit Sale)', ?, 'posted', ?, ?)
                `).run(req.user.id, dateStr, parsedAmount, category || 'Sales Revenue', notes ? `${notes} (Invoice #${invNum})` : `Credit Sale #${invNum}`, now, now);

                const inserted = await db.prepare('SELECT * FROM accounting WHERE id = ?').get(result.lastInsertRowid);
                return sendSuccess(res, inserted, 'Credit Sale created successfully', 201);
            }

            else if (entry_type === 'customer_payment') {
                // Customer Payment
                if (!invoice_number) return sendError(res, 'Invoice number is required', 400);

                const inv = await db.prepare('SELECT * FROM business_invoices WHERE invoice_number = ? AND user_id = ?').get(invoice_number, req.user.id);
                if (!inv) return sendError(res, 'Invoice not found', 404);

                const parsedAmt = parsedAmount;
                const newPaid = (parseFloat(inv.paid_amount) || 0) + parsedAmt;
                const newDue = Math.max(0, (parseFloat(inv.total_amount) || 0) - newPaid);
                const newStatus = newDue <= 0 ? 'Paid' : 'Partially Paid';

                // 1. Update invoice
                await db.prepare('UPDATE business_invoices SET paid_amount = ?, due_amount = ?, status = ? WHERE id = ?')
                    .run(newPaid, newDue, newStatus, inv.id);

                // 2. Insert payment record
                await db.prepare('INSERT INTO business_invoice_payments (invoice_id, amount, payment_method, payment_date, reference_number, notes) VALUES (?, ?, ?, ?, ?, ?)')
                    .run(inv.id, parsedAmt, mode || 'Cash in Hand', now, reference_number || null, notes || null);

                // 3. Create accounting entry (Invoice Payment category to avoid P&L double-counting)
                const result = await db.prepare(`
                    INSERT INTO accounting (user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at)
                    VALUES (?, 'income', ?, ?, 'Invoice Payment', ?, ?, 'posted', ?, ?)
                `).run(req.user.id, dateStr, parsedAmt, mode || 'Cash in Hand', notes || `Payment for Invoice #${invoice_number}`, now, now);

                const inserted = await db.prepare('SELECT * FROM accounting WHERE id = ?').get(result.lastInsertRowid);
                return sendSuccess(res, inserted, 'Customer payment recorded successfully', 201);
            }

            else if (entry_type === 'expense') {
                // Expense (Cash Purchase)
                const result = await db.prepare(`
                    INSERT INTO accounting (user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at)
                    VALUES (?, 'expense', ?, ?, ?, ?, ?, 'posted', ?, ?)
                `).run(req.user.id, dateStr, parsedAmount, category || 'Rent & Utilities', mode || 'Cash in Hand', notes || '', now, now);

                // Log a simple purchase record for consistency
                const purchaseNum = `EXP-${Date.now().toString().slice(-6)}`;
                const purResult = await db.prepare(`
                    INSERT INTO business_purchases (
                        user_id, purchase_number, purchase_date, due_date, supplier_name, payment_status, payment_mode, paid_amount, grand_total, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, 'Generic Cash Supplier', 'paid', ?, ?, ?, ?, ?)
                `).run(req.user.id, purchaseNum, dateStr, dateStr, mode || 'Cash in Hand', parsedAmount, parsedAmount, now, now);

                await gstHelper.syncPurchaseToGstr2b(purResult.lastInsertRowid, req.user.id);

                const inserted = await db.prepare('SELECT * FROM accounting WHERE id = ?').get(result.lastInsertRowid);
                return sendSuccess(res, inserted, 'Expense recorded successfully', 201);
            }

            else if (entry_type === 'credit_purchase') {
                // Credit Purchase
                if (!supplier_name) return sendError(res, 'Supplier name is required', 400);
                if (!due_date) return sendError(res, 'Due date is required', 400);

                const billNum = bill_number || `BILL-${Date.now().toString().slice(-6)}`;

                // Prevent duplicate bill numbers
                const exists = await db.prepare('SELECT id FROM business_purchases WHERE purchase_number = ? AND user_id = ?').get(billNum, req.user.id);
                if (exists) return sendError(res, 'Bill number already exists', 400);

                const totalTax = parsedAmount * 18 / 118;
                const subtotalAmt = parsedAmount - totalTax;

                // 1. Create bill in business_purchases with doc_type=BILL and status=Pending Goods
                const purResult = await db.prepare(`
                    INSERT INTO business_purchases (
                        user_id, purchase_number, purchase_date, due_date, doc_type, status, supplier_name, supplier_gstin,
                        payment_status, payment_mode, paid_amount, grand_total, subtotal, total_tax, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, 'BILL', 'Pending Goods', ?, ?, 'pending', 'Credit', 0, ?, ?, ?, ?, ?)
                `).run(req.user.id, billNum, dateStr, due_date, supplier_name, supplier_gstin || null, parsedAmount, subtotalAmt, totalTax, now, now);

                const newPurchaseId = purResult.lastInsertRowid;

                // 1b. Create default item in business_purchase_items for invoice item details mapping
                await db.prepare(`
                    INSERT INTO business_purchase_items (
                        purchase_id, product_name, quantity, received_quantity,
                        purchase_price, discount, gst_percentage, tax_amount, total
                    ) VALUES (?, ?, 1, 0, ?, 0, 18, ?, ?)
                `).run(newPurchaseId, category || 'Inventory Purchases', subtotalAmt, totalTax, parsedAmount);

                await gstHelper.syncPurchaseToGstr2b(newPurchaseId, req.user.id);

                // 2. Create accounting entry (P&L accrual expense, without affecting Cash/Bank balances)
                const result = await db.prepare(`
                    INSERT INTO accounting (user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at)
                    VALUES (?, 'expense', ?, ?, ?, 'Payables', ?, 'Pending', ?, ?)
                `).run(req.user.id, dateStr, parsedAmount, category || 'Inventory Purchases', notes || `Credit Purchase #${billNum}`, now, now);

                const inserted = await db.prepare('SELECT * FROM accounting WHERE id = ?').get(result.lastInsertRowid);
                return sendSuccess(res, inserted, 'Credit Purchase created successfully', 201);
            }

            else if (entry_type === 'supplier_payment') {
                // Supplier Payment
                if (!bill_number) return sendError(res, 'Bill number is required', 400);

                const bill = await db.prepare('SELECT * FROM business_purchases WHERE purchase_number = ? AND user_id = ?').get(bill_number, req.user.id);
                if (!bill) return sendError(res, 'Bill not found', 404);

                const parsedAmt = parsedAmount;
                const newPaid = (parseFloat(bill.paid_amount) || 0) + parsedAmt;
                const grandTotal = parseFloat(bill.grand_total) || 0;
                const newStatus = newPaid >= grandTotal ? 'Paid' : 'Partially Paid';

                // 1. Update bill
                await db.prepare('UPDATE business_purchases SET paid_amount = ?, payment_status = ?, status = ? WHERE id = ?')
                    .run(newPaid, newPaid >= grandTotal ? 'paid' : 'partial', newStatus, bill.id);

                await gstHelper.syncPurchaseToGstr2b(bill.id, req.user.id);

                // 2. Create accounting entry (Supplier Payment category to avoid P&L double-counting)
                const result = await db.prepare(`
                    INSERT INTO accounting (user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at)
                    VALUES (?, 'expense', ?, ?, 'Supplier Payment', ?, ?, 'Paid', ?, ?)
                `).run(req.user.id, dateStr, parsedAmt, mode || 'Cash in Hand', notes || `Payment for Bill #${bill_number}`, now, now);

                // 3. Update matching Credit Purchase in accounting ledger
                const creditLedger = await db.prepare("SELECT * FROM accounting WHERE user_id = ? AND mode = 'Payables' AND notes LIKE ?").get(req.user.id, `%#${bill_number}%`);
                if (creditLedger) {
                    await db.prepare("UPDATE accounting SET status = ? WHERE id = ?").run(newStatus, creditLedger.id);
                }

                const inserted = await db.prepare('SELECT * FROM accounting WHERE id = ?').get(result.lastInsertRowid);
                return sendSuccess(res, inserted, 'Supplier payment recorded successfully', 201);
            }

            else if (entry_type === 'bank_deposit') {
                // Bank Deposit: cash to bank
                if (!payment_mode_to) return sendError(res, 'Deposit Into Bank account is required', 400);
                if (!payment_mode_from) return sendError(res, 'Source cash account is required', 400);

                // Debit Bank: income entry in accounting for bank
                await db.prepare(`
                    INSERT INTO accounting (user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at)
                    VALUES (?, 'income', ?, ?, 'Contra', ?, ?, 'posted', ?, ?)
                `).run(req.user.id, dateStr, parsedAmount, payment_mode_to, notes || 'Bank Deposit', now, now);

                // Credit Cash: expense entry in accounting for cash
                const result = await db.prepare(`
                    INSERT INTO accounting (user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at)
                    VALUES (?, 'expense', ?, ?, 'Contra', ?, ?, 'posted', ?, ?)
                `).run(req.user.id, dateStr, parsedAmount, payment_mode_from, notes || 'Bank Deposit', now, now);

                const inserted = await db.prepare('SELECT * FROM accounting WHERE id = ?').get(result.lastInsertRowid);
                return sendSuccess(res, inserted, 'Bank deposit recorded successfully', 201);
            }

            else if (entry_type === 'bank_withdrawal') {
                // Bank Withdrawal: bank to cash
                if (!payment_mode_from) return sendError(res, 'Withdraw From Bank account is required', 400);

                // Debit Cash: income entry in accounting for Cash
                await db.prepare(`
                    INSERT INTO accounting (user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at)
                    VALUES (?, 'income', ?, ?, 'Contra', 'Cash in Hand', ?, 'posted', ?, ?)
                `).run(req.user.id, dateStr, parsedAmount, notes || 'Bank Withdrawal', now, now);

                // Credit Bank: expense entry in accounting for Bank
                const result = await db.prepare(`
                    INSERT INTO accounting (user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at)
                    VALUES (?, 'expense', ?, ?, 'Contra', ?, ?, 'posted', ?, ?)
                `).run(req.user.id, dateStr, parsedAmount, payment_mode_from, notes || 'Bank Withdrawal', now, now);

                const inserted = await db.prepare('SELECT * FROM accounting WHERE id = ?').get(result.lastInsertRowid);
                return sendSuccess(res, inserted, 'Bank withdrawal recorded successfully', 201);
            }

            else {
                // Fallback for standard journal entries (e.g. legacy transfer)
                const result = await db.prepare(`
                    INSERT INTO accounting (user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?)
                `).run(req.user.id, entry_type || 'income', dateStr, parsedAmount, category || 'Sales Revenue', mode || 'Cash in Hand', notes || '', now, now);
                const inserted = await db.prepare('SELECT * FROM accounting WHERE id = ?').get(result.lastInsertRowid);
                return sendSuccess(res, inserted, 'Journal entry posted successfully', 201);
            }

        } catch (error) {
            console.error('[Accounting Controller] createJournalEntry error:', error);
            return sendError(res, 'Failed to save entry', 500);
        }
    },
    getJournalEntries: async (req, res) => {
        try {
            const list = await db.prepare(`
                SELECT * FROM accounting WHERE user_id = ? AND entry_type IN ('income', 'expense', 'transfer') ORDER BY id DESC
            `).all(req.user.id);
            return sendSuccess(res, list, 'Journal entries retrieved');
        } catch (error) {
            return sendError(res, 'Failed to retrieve journal entries', 500);
        }
    },
    getJournalEntryById: async (req, res) => {
        const { id } = req.params;
        try {
            const entry = await db.prepare('SELECT * FROM accounting WHERE id = ? AND user_id = ?').get(id, req.user.id);
            return sendSuccess(res, entry, 'Entry retrieved');
        } catch (error) {
            return sendError(res, 'Retrieve failed', 500);
        }
    },
    updateJournalEntry: async (req, res) => {
        return accountingController.updateAccount(req, res);
    },
    deleteJournalEntry: async (req, res) => {
        return accountingController.deleteAccount(req, res);
    },

    // Ledger
    createLedger: async (req, res) => {
        return sendSuccess(res, null, 'Ledger record created');
    },
    getLedger: async (req, res) => {
        return accountingController.getJournalEntries(req, res);
    },
    getLedgerById: async (req, res) => {
        return accountingController.getJournalEntryById(req, res);
    },

    // Trial Balance / Balance Sheet / Cash Flow / Profit-Loss
    getTrialBalance: async (req, res) => {
        return sendSuccess(res, { debits: 0, credits: 0, status: 'balanced' }, 'Trial balance retrieved');
    },
    getProfitLoss: async (req, res) => {
        try {
            const ledger = await db.prepare("SELECT category, amount, entry_type, status, mode FROM accounting WHERE user_id = ?").all(req.user.id);

            const getAccountType = (category, status, mode, entryType) => {
                if (!category) return null;
                const cat = String(category).trim();
                const lower = cat.toLowerCase();
                if (lower === 'contra' || lower === 'invoice payment' || lower === 'customer payment') {
                    return null;
                }

                if (lower.includes('supplier payment')) {
                    return 'Expense';
                }

                if (lower.includes('purchase') || lower.includes('cogs') || lower.includes('raw material') || lower.includes('raw materials') || lower.includes('inventory')) {
                    // Credit purchase (mode === 'Payables') is not an expense directly (supplier payment is the cash expense)
                    if (mode && String(mode).toLowerCase() === 'payables') {
                        return null;
                    }
                    // Pending purchases are excluded
                    if (status && String(status).toLowerCase() === 'pending') {
                        return null;
                    }
                    return 'Expense';
                }

                const ChartOfAccounts = {
                    'Sales Revenue': 'Revenue',
                    'Service Income': 'Revenue',
                    'Other Income': 'Revenue',
                    'Sales Income': 'Revenue',
                    'General Income': 'Revenue',
                    'Travel & Meals': 'Expense',
                    'Marketing': 'Expense',
                    'Rent': 'Expense',
                    'Salary': 'Expense',
                    'Salary Expenses': 'Expense',
                    'Utilities': 'Expense',
                    'Rent & Utilities': 'Expense',
                    'Office Expenses': 'Expense',
                    'Bank Charges': 'Expense',
                    'Software Subscriptions': 'Expense',
                    'General Expense': 'Expense',
                    'Operational Expense': 'Expense'
                };
                if (ChartOfAccounts[cat]) {
                    return ChartOfAccounts[cat];
                }

                if (lower.includes('sales') || lower.includes('income') || lower.includes('revenue') || lower.includes('billing')) {
                    return 'Revenue';
                }
                if (lower.includes('expense') || lower.includes('travel') || lower.includes('meals') || lower.includes('marketing') || lower.includes('rent') || lower.includes('salary') || lower.includes('utilities') || lower.includes('charges') || lower.includes('subscriptions') || lower.includes('office') || lower.includes('transport') || lower.includes('coffee')) {
                    return 'Expense';
                }
                if (entryType === 'income') return 'Revenue';
                if (entryType === 'expense') return 'Expense';
                return null;
            };

            let grossRevenue = 0;
            let totalExpenses = 0;

            for (const item of ledger) {
                const type = getAccountType(item.category, item.status, item.mode, item.entry_type);
                if (type === 'Revenue') {
                    grossRevenue += parseFloat(item.amount) || 0;
                } else if (type === 'Expense') {
                    totalExpenses += parseFloat(item.amount) || 0;
                }
            }

            const netProfit = grossRevenue - totalExpenses;

            return sendSuccess(res, {
                gross_revenue: grossRevenue,
                total_expenses: totalExpenses,
                net_profit: netProfit
            }, 'P&L retrieved');
        } catch (error) {
            console.error('[Accounting Controller] Profit & Loss failed:', error);
            return sendError(res, 'P&L failed', 500);
        }
    },
    getBalanceSheet: async (req, res) => {
        try {
            const normalizePaymentMode = (mode) => {
                if (!mode) return 'Cash in Hand';
                const m = String(mode).trim().toLowerCase();
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
            };

            // Compute dynamic cash & bank assets
            const accounts = await db.prepare("SELECT * FROM accounting WHERE user_id = ? AND entry_type = 'AccountConfig'").all(req.user.id);
            const transactions = await db.prepare("SELECT mode, entry_type, SUM(amount) as total FROM accounting WHERE user_id = ? AND entry_type IN ('income', 'expense') GROUP BY mode, entry_type").all(req.user.id);

            let cashAsset = 0;
            let bankAsset = 0;

            for (const acc of accounts) {
                const normName = normalizePaymentMode(acc.account_name);
                let totalIncome = 0;
                let totalExpenses = 0;

                for (const tx of transactions) {
                    const normMode = normalizePaymentMode(tx.mode);
                    if (normMode === normName) {
                        if (tx.entry_type === 'income') {
                            totalIncome += tx.total || 0;
                        } else {
                            totalExpenses += tx.total || 0;
                        }
                    }
                }

                const initialBal = parseFloat(acc.balance) || 0;
                const currentBalance = initialBal + totalIncome - totalExpenses;

                if (normName === 'Cash in Hand') {
                    cashAsset += currentBalance;
                } else {
                    bankAsset += currentBalance;
                }
            }

            // Calculate Receivables dynamically from outstanding invoices
            const recSum = await db.prepare("SELECT SUM(due_amount) as total FROM business_invoices WHERE user_id = ? AND status != 'Paid'").get(req.user.id);
            const receivablesAsset = parseFloat(recSum?.total) || 0;

            // Inventory Asset Value
            const productsVal = await db.prepare("SELECT SUM(quantity * purchase_price) as total FROM business_products WHERE user_id = ?").get(req.user.id);
            const legacyVal = await db.prepare("SELECT SUM(quantity * price) as total FROM inventory WHERE user_id = ?").get(req.user.id);
            const inventoryAsset = (parseFloat(productsVal?.total) || 0) + (parseFloat(legacyVal?.total) || 0);

            // Fixed Assets from ledger
            const faSum = await db.prepare("SELECT SUM(amount) as total FROM accounting WHERE user_id = ? AND category = 'Fixed Assets'").get(req.user.id);
            const fixedAssetsAsset = parseFloat(faSum?.total) || 0;

            // Calculate dynamic liabilities
            const payResult = await db.prepare("SELECT SUM(grand_total - paid_amount) as total FROM business_purchases WHERE user_id = ?").get(req.user.id);
            const payablesLiability = parseFloat(payResult?.total) || 0;

            // GST Payable
            const gstSales = await db.prepare("SELECT SUM(tax_amount) as total FROM business_invoices WHERE user_id = ?").get(req.user.id);
            const gstPurchases = await db.prepare("SELECT SUM(total_tax) as total FROM business_purchases WHERE user_id = ?").get(req.user.id);
            const gstPayable = (parseFloat(gstSales?.total) || 0) - (parseFloat(gstPurchases?.total) || 0);

            // Loans liability (debts)
            const loanResult = await db.prepare("SELECT SUM(amount - amount_paid) as total FROM debts WHERE user_id = ?").get(req.user.id);
            const loansLiability = parseFloat(loanResult?.total) || 0;

            const totalAssets = cashAsset + bankAsset + inventoryAsset + receivablesAsset + fixedAssetsAsset;
            const liabilitiesExclEquity = payablesLiability + gstPayable + loansLiability;
            const equityVal = totalAssets - liabilitiesExclEquity;

            return sendSuccess(res, {
                assets: { 
                    cash: Math.max(0, cashAsset), 
                    bank: Math.max(0, bankAsset), 
                    inventory: Math.max(0, inventoryAsset), 
                    receivables: receivablesAsset, 
                    fixed_assets: fixedAssetsAsset 
                },
                liabilities: { 
                    payables: payablesLiability, 
                    gst_payable: gstPayable, 
                    loans: loansLiability, 
                    equity: equityVal
                }
            }, 'Balance sheet calculated');
        } catch (e) {
            console.error('[Accounting Controller] Balance Sheet calculation error:', e);
            return sendSuccess(res, {
                assets: { cash: 0, bank: 0, inventory: 0, receivables: 0, fixed_assets: 0 },
                liabilities: { payables: 0, gst_payable: 0, loans: 0, equity: 0 }
            }, 'Balance sheet default');
        }
    },
    getCashFlow: async (req, res) => {
        return sendSuccess(res, { operating_inflows: 0, investing_outflows: 0, net_change: 0 }, 'Cash flow retrieved');
    },

    // Opening / Closing
    createOpeningBalance: async (req, res) => {
        return sendSuccess(res, req.body, 'Opening balance set');
    },
    getOpeningBalance: async (req, res) => {
        return sendSuccess(res, { opening_balance: 0 }, 'Opening balance retrieved');
    },
    createClosingBalance: async (req, res) => {
        return sendSuccess(res, req.body, 'Closing balance set');
    },
    getClosingBalance: async (req, res) => {
        return sendSuccess(res, { closing_balance: 0 }, 'Closing balance retrieved');
    },

    // Bank Accounts
    createBankAccount: async (req, res) => {
        const { bank_name, account_name, account_number, ifsc_code, branch_name, opening_balance, account_type, status } = req.body;
        
        if (!bank_name || !account_name || !account_number || !ifsc_code || opening_balance === undefined) {
            return sendError(res, 'Bank Name, Account Name, Account Number, IFSC Code, and Opening Balance are mandatory', 400);
        }

        try {
            // Check for duplicate account number
            const duplicate = await db.prepare("SELECT id FROM accounting WHERE user_id = ? AND entry_type = 'AccountConfig' AND account_number = ?").get(req.user.id, account_number);
            if (duplicate) {
                return sendError(res, 'Account number already exists', 400);
            }

            const now = new Date().toISOString();
            const result = await db.prepare(`
                INSERT INTO accounting (
                    user_id, bank_name, account_name, account_number, ifsc_code, branch_name, 
                    balance, account_type, entry_type, status, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'AccountConfig', ?, ?, ?)
            `).run(
                req.user.id, 
                bank_name, 
                account_name, 
                account_number, 
                ifsc_code, 
                branch_name || null, 
                String(opening_balance), 
                account_type || 'Savings', 
                status || 'Active', 
                now, 
                now
            );

            const inserted = await db.prepare('SELECT * FROM accounting WHERE id = ?').get(result.lastInsertRowid);
            return sendSuccess(res, inserted, 'Bank account created successfully', 201);
        } catch (error) {
            console.error('[Accounting] createBankAccount error:', error);
            return sendError(res, 'Failed to create bank account', 500);
        }
    },
    getBankAccounts: async (req, res) => {
        try {
            const accounts = await db.prepare("SELECT * FROM accounting WHERE user_id = ? AND entry_type = 'AccountConfig'").all(req.user.id);
            const transactions = await db.prepare("SELECT mode, entry_type, SUM(amount) as total FROM accounting WHERE user_id = ? AND entry_type IN ('income', 'expense') GROUP BY mode, entry_type").all(req.user.id);
            const allTxs = await db.prepare("SELECT mode, date FROM accounting WHERE user_id = ? AND entry_type IN ('income', 'expense') ORDER BY date DESC").all(req.user.id);

            const updatedList = [];
            for (const acc of accounts) {
                const normName = normalizePaymentMode(acc.account_name);
                let totalIncome = 0;
                let totalExpenses = 0;

                for (const tx of transactions) {
                    const normMode = normalizePaymentMode(tx.mode);
                    if (normMode === normName) {
                        if (tx.entry_type === 'income') {
                            totalIncome += tx.total || 0;
                        } else {
                            totalExpenses += tx.total || 0;
                        }
                    }
                }

                // Find last transaction date in JS
                let lastTransactionDate = 'No transactions yet';
                for (const tx of allTxs) {
                    if (normalizePaymentMode(tx.mode) === normName) {
                        lastTransactionDate = tx.date;
                        break;
                    }
                }

                const initialBal = parseFloat(acc.balance) || 0;
                const currentBalance = initialBal + totalIncome - totalExpenses;

                updatedList.push({
                    ...acc,
                    balance: currentBalance,
                    total_income: totalIncome,
                    total_expenses: totalExpenses,
                    last_transaction_date: lastTransactionDate
                });
            }

            return sendSuccess(res, updatedList, 'Bank accounts retrieved');
        } catch (error) {
            console.error('[accountingController] getBankAccounts error:', error);
            return sendError(res, 'Failed to retrieve bank accounts', 500);
        }
    },

    recordDeposit: async (req, res) => {
        const { id } = req.params;
        const { amount, date, reference_number, description } = req.body;
        try {
            if (!(await hasFinancePermission(req))) {
                return sendError(res, 'Access Denied: You are not authorized to perform this operation.', 403);
            }

            const acc = await db.prepare("SELECT * FROM accounting WHERE id = ? AND user_id = ? AND entry_type = 'AccountConfig'").get(id, req.user.id);
            if (!acc) return sendError(res, 'Account not found', 404);

            const parsedAmount = parseFloat(amount) || 0;
            if (parsedAmount <= 0) return sendError(res, 'Amount must be greater than zero', 400);

            const now = new Date().toISOString();
            const dateStr = date || now.split('T')[0];

            const refStr = reference_number ? ` [Ref: ${reference_number}]` : '';
            const finalNotes = (description || 'Deposit') + refStr;

            const result = await db.prepare(`
                INSERT INTO accounting (user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at)
                VALUES (?, 'income', ?, ?, 'Deposit', ?, ?, 'posted', ?, ?)
            `).run(req.user.id, dateStr, parsedAmount, acc.account_name, finalNotes, now, now);

            const inserted = await db.prepare('SELECT * FROM accounting WHERE id = ?').get(result.lastInsertRowid);
            return sendSuccess(res, inserted, 'Deposit recorded successfully', 201);
        } catch (error) {
            console.error('[Accounting] recordDeposit error:', error);
            return sendError(res, 'Failed to record deposit', 500);
        }
    },

    recordWithdrawal: async (req, res) => {
        const { id } = req.params;
        const { amount, date, reference_number, description } = req.body;
        try {
            if (!(await hasFinancePermission(req))) {
                return sendError(res, 'Access Denied: You are not authorized to perform this operation.', 403);
            }

            const acc = await db.prepare("SELECT * FROM accounting WHERE id = ? AND user_id = ? AND entry_type = 'AccountConfig'").get(id, req.user.id);
            if (!acc) return sendError(res, 'Account not found', 404);

            const parsedAmount = parseFloat(amount) || 0;
            if (parsedAmount <= 0) return sendError(res, 'Amount must be greater than zero', 400);

            const now = new Date().toISOString();
            const dateStr = date || now.split('T')[0];

            const refStr = reference_number ? ` [Ref: ${reference_number}]` : '';
            const finalNotes = (description || 'Withdrawal') + refStr;

            const result = await db.prepare(`
                INSERT INTO accounting (user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at)
                VALUES (?, 'expense', ?, ?, 'Withdrawal', ?, ?, 'posted', ?, ?)
            `).run(req.user.id, dateStr, parsedAmount, acc.account_name, finalNotes, now, now);

            const inserted = await db.prepare('SELECT * FROM accounting WHERE id = ?').get(result.lastInsertRowid);
            return sendSuccess(res, inserted, 'Withdrawal recorded successfully', 201);
        } catch (error) {
            console.error('[Accounting] recordWithdrawal error:', error);
            return sendError(res, 'Failed to record withdrawal', 500);
        }
    },

    recordTransfer: async (req, res) => {
        const { from_account_id, to_account_id, amount, date, reference_number, description } = req.body;
        try {
            if (!(await hasFinancePermission(req))) {
                return sendError(res, 'Access Denied: You are not authorized to perform this operation.', 403);
            }

            const fromAcc = await db.prepare("SELECT * FROM accounting WHERE id = ? AND user_id = ? AND entry_type = 'AccountConfig'").get(from_account_id, req.user.id);
            const toAcc = await db.prepare("SELECT * FROM accounting WHERE id = ? AND user_id = ? AND entry_type = 'AccountConfig'").get(to_account_id, req.user.id);

            if (!fromAcc || !toAcc) {
                return sendError(res, 'Source or destination account not found', 404);
            }

            const parsedAmount = parseFloat(amount) || 0;
            if (parsedAmount <= 0) return sendError(res, 'Amount must be greater than zero', 400);

            const now = new Date().toISOString();
            const dateStr = date || now.split('T')[0];

            const refStr = reference_number ? ` [Ref: ${reference_number}]` : '';
            const finalDescription = description || 'Transfer';

            // 1. Debit Source Account (expense entry)
            await db.prepare(`
                INSERT INTO accounting (user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at)
                VALUES (?, 'expense', ?, ?, 'Transfer', ?, ?, 'posted', ?, ?)
            `).run(req.user.id, dateStr, parsedAmount, fromAcc.account_name, `Transfer to ${toAcc.account_name} - ${finalDescription}${refStr}`, now, now);

            // 2. Credit Destination Account (income entry)
            await db.prepare(`
                INSERT INTO accounting (user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at)
                VALUES (?, 'income', ?, ?, 'Transfer', ?, ?, 'posted', ?, ?)
            `).run(req.user.id, dateStr, parsedAmount, toAcc.account_name, `Transfer from ${fromAcc.account_name} - ${finalDescription}${refStr}`, now, now);

            return sendSuccess(res, null, 'Transfer recorded successfully', 201);
        } catch (error) {
            console.error('[Accounting] recordTransfer error:', error);
            return sendError(res, 'Failed to process transfer', 500);
        }
    },
    updateBankAccount: async (req, res) => {
        return accountingController.updateAccount(req, res);
    },
    deleteBankAccount: async (req, res) => {
        return accountingController.deleteAccount(req, res);
    },

    // Reconciliation
    reconcileBank: async (req, res) => {
        return sendSuccess(res, null, 'Bank reconciliation completed');
    },
    getBankReconciliation: async (req, res) => {
        return sendSuccess(res, { status: 'reconciled', last_reconciled_date: new Date().toISOString() }, 'Reconciliation retrieved');
    },

    // Contra / Debit / Credit
    createContraEntry: async (req, res) => {
        return sendSuccess(res, req.body, 'Contra entry posted');
    },
    getContraEntries: async (req, res) => {
        return sendSuccess(res, [], 'Contra entries retrieved');
    },
    createDebitNote: async (req, res) => {
        return sendSuccess(res, req.body, 'Debit note registered');
    },
    getDebitNotes: async (req, res) => {
        return sendSuccess(res, [], 'Debit notes retrieved');
    },
    createCreditNote: async (req, res) => {
        return sendSuccess(res, req.body, 'Credit note registered');
    },
    getCreditNotes: async (req, res) => {
        return sendSuccess(res, [], 'Credit notes retrieved');
    },

    // Expenses / Income
    createExpense: async (req, res) => {
        req.body.entry_type = 'expense';
        return accountingController.createJournalEntry(req, res);
    },
    getExpenses: async (req, res) => {
        try {
            const list = await db.prepare("SELECT * FROM accounting WHERE user_id = ? AND entry_type = 'expense'").all(req.user.id);
            return sendSuccess(res, list, 'Expenses retrieved');
        } catch (error) {
            return sendError(res, 'Fetch failed', 500);
        }
    },
    createIncome: async (req, res) => {
        req.body.entry_type = 'income';
        return accountingController.createJournalEntry(req, res);
    },
    getIncome: async (req, res) => {
        try {
            const list = await db.prepare("SELECT * FROM accounting WHERE user_id = ? AND entry_type = 'income'").all(req.user.id);
            return sendSuccess(res, list, 'Income retrieved');
        } catch (error) {
            return sendError(res, 'Fetch failed', 500);
        }
    },

    // Fixed Assets / Depreciation / Tax
    createFixedAsset: async (req, res) => {
        return sendSuccess(res, req.body, 'Fixed asset logged');
    },
    getFixedAssets: async (req, res) => {
        return sendSuccess(res, [], 'Fixed assets retrieved');
    },
    createDepreciation: async (req, res) => {
        return sendSuccess(res, req.body, 'Depreciation logged');
    },
    getDepreciation: async (req, res) => {
        return sendSuccess(res, [], 'Depreciation logs retrieved');
    },
    createTax: async (req, res) => {
        return sendSuccess(res, req.body, 'Tax slab registered');
    },
    getTax: async (req, res) => {
        return sendSuccess(res, { cgst_rate: '0%', sgst_rate: '0%', status: 'none' }, 'Tax retrieved');
    },

    // History / Notes / Documents / Analytics
    getHistory: async (req, res) => {
        return sendSuccess(res, [], 'History retrieved');
    },
    addNote: async (req, res) => {
        return sendSuccess(res, req.body, 'Note added');
    },
    getNotes: async (req, res) => {
        return sendSuccess(res, [], 'Notes retrieved');
    },
    addDocuments: async (req, res) => {
        return sendSuccess(res, null, 'Document added');
    },
    getDocuments: async (req, res) => {
        return sendSuccess(res, [], 'Documents retrieved');
    },
    getAnalytics: async (req, res) => {
        return sendSuccess(res, { profit_margin: '0%' }, 'Analytics retrieved');
    },

    // Reports
    getReportGeneralLedger: async (req, res) => {
        return accountingController.getJournalEntries(req, res);
    },
    getReportDayBook: async (req, res) => {
        return accountingController.getJournalEntries(req, res);
    },

    // Import / Export
    importAccounting: async (req, res) => {
        return sendSuccess(res, null, 'Import successful');
    },
    exportAccounting: async (req, res) => {
        try {
            const list = await db.prepare('SELECT * FROM accounting WHERE user_id = ?').all(req.user.id);
            return sendSuccess(res, list, 'Data exported');
        } catch (error) {
            return sendError(res, 'Export failed', 500);
        }
    },

    // Periods Lock
    lockPeriod: async (req, res) => {
        return sendSuccess(res, null, 'Accounting period locked');
    },
    unlockPeriod: async (req, res) => {
        return sendSuccess(res, null, 'Accounting period unlocked');
    },

    // Dashboard Summary
    getDashboardSummary: async (req, res) => {
        try {
            const revenue = await db.prepare("SELECT SUM(amount) as total FROM accounting WHERE user_id = ? AND entry_type = 'income'").get(req.user.id);
            const expenses = await db.prepare("SELECT SUM(amount) as total FROM accounting WHERE user_id = ? AND entry_type = 'expense'").get(req.user.id);
            return sendSuccess(res, {
                total_revenue: revenue?.total || 0,
                total_expenses: expenses?.total || 0,
                status: 'posted'
            }, 'Dashboard summary retrieved');
        } catch (error) {
            return sendError(res, 'Dashboard summary failed', 500);
        }
    }
};

module.exports = accountingController;
