const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { logAuditEvent } = require('../utils/auditLogger');

const bankAccountController = {
    getBankAccounts: async (req, res) => {
        try {
            const userId = req.user.id;
            const { q, status } = req.query;

            let sql = "SELECT * FROM bank_accounts WHERE user_id = ?";
            const params = [userId];

            if (q) {
                sql += " AND (bank_name LIKE ? OR account_holder LIKE ? OR account_number LIKE ? OR upi_id LIKE ?)";
                const searchTerm = `%${q}%`;
                params.push(searchTerm, searchTerm, searchTerm, searchTerm);
            }

            if (status) {
                sql += " AND status = ?";
                params.push(status);
            }

            sql += " ORDER BY id DESC";

            let accounts = await db.prepare(sql).all(...params);

            // Also retrieve accounts from accounting table (entry_type = 'AccountConfig' from Books module)
            let accRows = [];
            try {
                accRows = await db.prepare(`
                    SELECT 
                        id,
                        COALESCE(NULLIF(bank_name, ''), account_name, 'Bank') as bank_name,
                        account_name as account_holder,
                        account_name,
                        account_number,
                        ifsc_code as ifsc,
                        branch_name as branch,
                        CAST(COALESCE(balance, 0) as REAL) as current_balance,
                        CAST(COALESCE(balance, 0) as REAL) as opening_balance,
                        status
                    FROM accounting 
                    WHERE user_id = ? AND entry_type = 'AccountConfig' AND LOWER(account_name) NOT LIKE '%cash%'
                `).all(userId);
            } catch (accErr) {}

            let allSysBanks = [];
            let allAccBanks = [];
            try {
                allSysBanks = await db.prepare("SELECT * FROM bank_accounts ORDER BY id ASC").all();
            } catch (e) {}
            try {
                allAccBanks = await db.prepare(`
                    SELECT 
                        id,
                        COALESCE(NULLIF(bank_name, ''), account_name, 'Bank') as bank_name,
                        account_name as account_holder,
                        account_name,
                        account_number,
                        ifsc_code as ifsc,
                        branch_name as branch,
                        CAST(COALESCE(balance, 0) as REAL) as current_balance,
                        CAST(COALESCE(balance, 0) as REAL) as opening_balance,
                        status
                    FROM accounting 
                    WHERE entry_type = 'AccountConfig' AND LOWER(account_name) NOT LIKE '%cash%'
                `).all();
            } catch (e) {}

            let allBanks = [...(accounts || []), ...(accRows || []), ...(allSysBanks || []), ...(allAccBanks || [])];

            // Deduplicate by account_number / id / bank_name
            const deduplicated = [];
            const seen = new Set();
            for (const b of allBanks) {
                const key = String(b.account_number || b.id || b.bank_name || '').trim().toLowerCase();
                if (key && !seen.has(key)) {
                    seen.add(key);
                    deduplicated.push(b);
                }
            }

            return sendSuccess(res, deduplicated, 'Bank accounts fetched successfully');
        } catch (error) {
            console.error('[Bank Account Controller Error]', error);
            return sendError(res, 'Failed to fetch bank accounts', 500);
        }
    },

    getBankAccountById: async (req, res) => {
        try {
            const { id } = req.params;
            const account = await db.prepare('SELECT * FROM bank_accounts WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!account) {
                return sendError(res, 'Bank account not found', 404);
            }
            return sendSuccess(res, account, 'Bank account fetched successfully');
        } catch (error) {
            return sendError(res, 'Failed to fetch bank account details', 500);
        }
    },

    createBankAccount: async (req, res) => {
        try {
            const userId = req.user.id;
            const bankName = req.body.bankName || req.body.bank_name;
            const accountHolder = req.body.accountHolder || req.body.account_holder || req.body.account_name;
            const accountNumber = req.body.accountNumber || req.body.account_number;
            const ifsc = req.body.ifsc || req.body.ifsc_code;
            const branch = req.body.branch || req.body.branch_name;
            const upiId = req.body.upiId || req.body.upi_id;
            const openBal = parseFloat(req.body.openingBalance ?? req.body.opening_balance ?? 0) || 0;
            const currBal = req.body.currentBalance !== undefined 
                ? parseFloat(req.body.currentBalance) 
                : (req.body.current_balance !== undefined ? parseFloat(req.body.current_balance) : openBal);
            const status = req.body.status || 'Active';

            if (!bankName || !accountNumber) {
                return sendError(res, 'Bank name and account number are required', 400);
            }

            const now = new Date().toISOString();

            const result = await db.prepare(`
                INSERT INTO bank_accounts (
                    user_id, bank_name, account_holder, account_number, ifsc, branch, upi_id,
                    opening_balance, current_balance, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                userId, bankName, accountHolder || req.user.username || 'Account Holder',
                accountNumber, ifsc || null, branch || null, upiId || null,
                openBal, currBal, status, now, now
            );

            // Also keep accounting table in sync
            try {
                await db.prepare(`
                    INSERT INTO accounting (
                        user_id, bank_name, account_name, account_number, ifsc_code, branch_name, 
                        balance, account_type, entry_type, status, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Asset', 'AccountConfig', ?, ?, ?)
                `).run(
                    userId, bankName, accountHolder || bankName, accountNumber,
                    ifsc || null, branch || null, String(currBal), status, now, now
                );
            } catch (errAcc) {}

            const newAccount = await db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(result.lastInsertRowid);

            await logAuditEvent(req, {
                action: 'Create Bank Account',
                module: 'Bank Accounts',
                recordId: newAccount.id,
                newValue: newAccount,
                details: `Created bank account "${bankName}" (${accountNumber})`
            });

            return sendSuccess(res, newAccount, 'Bank account created successfully', 201);
        } catch (error) {
            console.error('[Create Bank Account Error]', error);
            return sendError(res, 'Failed to create bank account', 500);
        }
    },

    updateBankAccount: async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.user.id;
            const existing = await db.prepare('SELECT * FROM bank_accounts WHERE id = ? AND user_id = ?').get(id, userId);

            if (!existing) {
                return sendError(res, 'Bank account not found', 404);
            }

            const { bankName, accountHolder, accountNumber, ifsc, branch, upiId, openingBalance, currentBalance, status } = req.body;
            const now = new Date().toISOString();

            await db.prepare(`
                UPDATE bank_accounts SET
                    bank_name = COALESCE(?, bank_name),
                    account_holder = COALESCE(?, account_holder),
                    account_number = COALESCE(?, account_number),
                    ifsc = COALESCE(?, ifsc),
                    branch = COALESCE(?, branch),
                    upi_id = COALESCE(?, upi_id),
                    opening_balance = COALESCE(?, opening_balance),
                    current_balance = COALESCE(?, current_balance),
                    status = COALESCE(?, status),
                    updated_at = ?
                WHERE id = ? AND user_id = ?
            `).run(
                bankName, accountHolder, accountNumber, ifsc, branch, upiId,
                openingBalance !== undefined ? parseFloat(openingBalance) : null,
                currentBalance !== undefined ? parseFloat(currentBalance) : null,
                status, now, id, userId
            );

            const updated = await db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(id);

            await logAuditEvent(req, {
                action: 'Update Bank Account',
                module: 'Bank Accounts',
                recordId: id,
                oldValue: existing,
                newValue: updated,
                details: `Updated bank account "${updated.bank_name}"`
            });

            return sendSuccess(res, updated, 'Bank account updated successfully');
        } catch (error) {
            console.error('[Update Bank Account Error]', error);
            return sendError(res, 'Failed to update bank account', 500);
        }
    },

    updateBalance: async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.user.id;
            const { amount, type = 'credit', description = 'Transaction update' } = req.body; // 'credit' or 'debit'

            const existing = await db.prepare('SELECT * FROM bank_accounts WHERE id = ? AND user_id = ?').get(id, userId);
            if (!existing) {
                return sendError(res, 'Bank account not found', 404);
            }

            const delta = parseFloat(amount) || 0;
            const newBalance = type === 'credit' ? (existing.current_balance + delta) : (existing.current_balance - delta);
            const now = new Date().toISOString();

            await db.prepare('UPDATE bank_accounts SET current_balance = ?, updated_at = ? WHERE id = ?').run(newBalance, now, id);

            const updated = await db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(id);

            await logAuditEvent(req, {
                action: 'Update Bank Balance',
                module: 'Bank Accounts',
                recordId: id,
                oldValue: { current_balance: existing.current_balance },
                newValue: { current_balance: newBalance, type, amount: delta },
                details: `Updated balance for ${existing.bank_name} by ${type === 'credit' ? '+' : '-'}${delta}. Description: ${description}`
            });

            return sendSuccess(res, updated, 'Balance updated successfully');
        } catch (error) {
            console.error('[Update Bank Balance Error]', error);
            return sendError(res, 'Failed to update bank balance', 500);
        }
    },

    deleteBankAccount: async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.user.id;
            const existing = await db.prepare('SELECT * FROM bank_accounts WHERE id = ? AND user_id = ?').get(id, userId);

            if (!existing) {
                return sendError(res, 'Bank account not found', 404);
            }

            await db.prepare('DELETE FROM bank_accounts WHERE id = ? AND user_id = ?').run(id, userId);

            await logAuditEvent(req, {
                action: 'Delete Bank Account',
                module: 'Bank Accounts',
                recordId: id,
                oldValue: existing,
                details: `Deleted bank account "${existing.bank_name}"`
            });

            return sendSuccess(res, { id }, 'Bank account deleted successfully');
        } catch (error) {
            return sendError(res, 'Failed to delete bank account', 500);
        }
    }
};

module.exports = bankAccountController;
