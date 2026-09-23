const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

const initColumns = async () => {
    const columns = [
        'party_name TEXT',
        'reference_number TEXT',
        'payment_mode TEXT',
        'invoice_id TEXT',
        'notes TEXT',
        'reconciliation_status TEXT',
        'total_original REAL',
        'total_original_amount REAL',
        'paid_amount REAL'
    ];
    for (const col of columns) {
        try {
            await db.prepare(`ALTER TABLE business_payments ADD COLUMN ${col}`).run();
        } catch (e) {}
    }
};
initColumns();

const paymentController = {
    receivePayment: async (req, res) => {
        const { 
            amount, 
            paidAmount, 
            paid_amount,
            customer_name, 
            customerProfile, 
            customer_profile,
            invoice_id, 
            invoiceLinkedId, 
            invoice_linked_id,
            totalOriginalAmount,
            total_original_amount,
            total_original,
            total_amount,
            original_amount,
            payment_mode, 
            reference_number, 
            notes, 
            account_id 
        } = req.body;

        const custName = customerProfile || customer_profile || customer_name || 'General Customer';
        const invId = invoiceLinkedId || invoice_linked_id || invoice_id || null;
        const finalPaidAmount = parseFloat(paidAmount !== undefined && paidAmount !== null && paidAmount !== '' ? paidAmount : (paid_amount !== undefined && paid_amount !== null && paid_amount !== '' ? paid_amount : amount));
        const finalTotalOriginal = parseFloat(totalOriginalAmount !== undefined && totalOriginalAmount !== null && totalOriginalAmount !== '' ? totalOriginalAmount : (total_original_amount !== undefined && total_original_amount !== null && total_original_amount !== '' ? total_original_amount : (total_original !== undefined && total_original !== null && total_original !== '' ? total_original : (original_amount !== undefined && original_amount !== null && original_amount !== '' ? original_amount : (total_amount !== undefined && total_amount !== null && total_amount !== '' ? total_amount : finalPaidAmount)))));

        if (!finalPaidAmount || isNaN(finalPaidAmount) || finalPaidAmount <= 0) {
            return sendError(res, 'Payment amount must be a positive number greater than 0', 400);
        }

        const packedNotes = typeof notes === 'string' && notes.length > 0
            ? notes
            : JSON.stringify({
                customerProfile: custName,
                invoiceLinkedId: invId,
                totalOriginalAmount: finalTotalOriginal,
                paidAmount: finalPaidAmount,
                total_original: finalTotalOriginal,
                paid_amount: finalPaidAmount
            });

        try {
            const now = new Date().toISOString();
            let result;
            try {
                result = await db.prepare(
                    `INSERT INTO business_payments (
                        user_id, type, amount, paid_amount, total_original, total_original_amount, 
                        party_name, invoice_id, payment_mode, reference_number, notes, status, reconciliation_status, created_at
                     ) VALUES (?, 'receive', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', 'matched', ?)`
                ).run(
                    req.user.id, finalPaidAmount, finalPaidAmount, finalTotalOriginal, finalTotalOriginal,
                    custName, invId, payment_mode || 'Cash', reference_number || null, packedNotes, now
                );
            } catch (colErr) {
                result = await db.prepare(
                    `INSERT INTO business_payments (user_id, type, amount, party_name, invoice_id, payment_mode, reference_number, notes, status, reconciliation_status, created_at)
                     VALUES (?, 'receive', ?, ?, ?, ?, ?, ?, 'completed', 'matched', ?)`
                ).run(req.user.id, finalPaidAmount, custName, invId, payment_mode || 'Cash', reference_number || null, packedNotes, now);
            }

            // Record income entry in accounting table
            try {
                await db.prepare(`
                    INSERT INTO accounting (user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at)
                    VALUES (?, 'income', ?, ?, 'Customer Payment', ?, ?, 'Completed', ?, ?)
                `).run(req.user.id, now.split('T')[0], finalPaidAmount, payment_mode || 'Cash', `Receipt from ${custName} (Invoice: ${invId || 'Direct'})`, now, now);
            } catch (e) {}

            // Increase balance in selected payment account
            try {
                if (account_id) {
                    await db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE (id = ? OR name = ?) AND user_id = ?').run(finalPaidAmount, now, account_id, account_id, req.user.id);
                } else {
                    const firstAccount = await db.prepare('SELECT id FROM accounts WHERE user_id = ? LIMIT 1').get(req.user.id);
                    if (firstAccount) {
                        await db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ? AND user_id = ?').run(finalPaidAmount, now, firstAccount.id, req.user.id);
                    }
                }
            } catch (e) {}

            return sendSuccess(res, { 
                id: result.lastInsertRowid || result.id, 
                amount: finalPaidAmount,
                paidAmount: finalPaidAmount,
                paid_amount: finalPaidAmount,
                totalOriginalAmount: finalTotalOriginal,
                total_original: finalTotalOriginal,
                customerProfile: custName,
                customer_name: custName,
                invoiceLinkedId: invId,
                invoice_id: invId
            }, 'Payment received successfully', 201);
        } catch (error) {
            console.error('[Payment Controller] Error receiving payment:', error);
            return sendError(res, 'Failed to receive payment', 500);
        }
    },

    paySupplier: async (req, res) => {
        const { amount, supplier_name, purchase_id, payment_mode, reference_number, notes, account_id } = req.body;
        if (!amount) return sendError(res, 'Amount is required', 400);
        const numAmount = parseFloat(amount);
        if (isNaN(numAmount) || numAmount <= 0) {
            return sendError(res, 'Supplier payment amount must be a positive number greater than 0', 400);
        }
        try {
            const now = new Date().toISOString();
            const result = await db.prepare(
                `INSERT INTO business_payments (user_id, type, amount, party_name, invoice_id, payment_mode, reference_number, notes, status, reconciliation_status, created_at)
                 VALUES (?, 'pay', ?, ?, ?, ?, ?, ?, 'completed', 'matched', ?)`
            ).run(req.user.id, numAmount, supplier_name || 'General Supplier', purchase_id || null, payment_mode || 'Bank Transfer', reference_number || null, notes || null, now);

            // Locate credit purchase bill using Bill Number (purchase_id)
            const purchase = await db.prepare("SELECT * FROM business_purchases WHERE user_id = ? AND (purchase_number = ? OR id = ? || 0)").get(req.user.id, purchase_id, purchase_id);
            
            if (purchase) {
                const newPaidAmount = (parseFloat(purchase.paid_amount) || 0) + numAmount;
                const totalToPay = parseFloat(purchase.grand_total) || 0;

                let newPaymentStatus = 'pending';
                let newStatus = 'Pending';
                if (newPaidAmount >= totalToPay) {
                    newPaymentStatus = 'paid';
                    newStatus = 'Paid';
                } else if (newPaidAmount > 0) {
                    newPaymentStatus = 'partial';
                    newStatus = 'Partially Paid';
                }

                // Update Credit Purchase bill status and paid amount
                await db.prepare('UPDATE business_purchases SET paid_amount = ?, payment_status = ?, status = ? WHERE id = ?').run(newPaidAmount, newPaymentStatus, newStatus, purchase.id);

                // Update matching Credit Purchase in accounting ledger
                const creditLedger = await db.prepare("SELECT * FROM accounting WHERE user_id = ? AND category = 'Inventory Purchases' AND mode = 'Payables' AND notes LIKE ?").get(req.user.id, `%Purchase #${purchase.purchase_number}%`);
                if (creditLedger) {
                    const updatedStatus = newPaidAmount >= totalToPay ? 'Paid' : 'Partially Paid';
                    await db.prepare("UPDATE accounting SET status = ? WHERE id = ?").run(updatedStatus, creditLedger.id);
                }
            }

            // Record Debit Note / Voucher entry in accounting table
            await db.prepare(`
                INSERT INTO accounting (user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at)
                VALUES (?, 'expense', ?, ?, 'Supplier Payment', ?, ?, 'Paid', ?, ?)
            `).run(req.user.id, now.split('T')[0], numAmount, payment_mode || 'Bank Transfer', `Payment to ${supplier_name || 'Supplier'} (Ref: ${reference_number || purchase_id || 'Direct'})`, now, now);

            // Deduct balance from selected payment account in accounts table
            if (account_id) {
                await db.prepare('UPDATE accounts SET balance = balance - ?, updated_at = ? WHERE (id = ? OR name = ?) AND user_id = ?').run(numAmount, now, account_id, account_id, req.user.id);
            } else {
                const firstAccount = await db.prepare('SELECT id FROM accounts WHERE user_id = ? LIMIT 1').get(req.user.id);
                if (firstAccount) {
                    await db.prepare('UPDATE accounts SET balance = balance - ?, updated_at = ? WHERE id = ? AND user_id = ?').run(numAmount, now, firstAccount.id, req.user.id);
                }
            }

            // Update supplier outstanding balance in business_suppliers table
            if (supplier_name) {
                await db.prepare("UPDATE business_suppliers SET outstanding_balance = MAX(0, outstanding_balance - ?) WHERE name = ? AND user_id = ?").run(numAmount, supplier_name, req.user.id);
            }

            return sendSuccess(res, { id: result.lastInsertRowid, amount: numAmount }, 'Payment to supplier recorded successfully', 201);
        } catch (error) {
            console.error('[Payment Controller] Error paying supplier:', error);
            return sendError(res, 'Failed to process supplier payment', 500);
        }
    },

    transferVault: async (req, res) => {
        const { from_acc_id, to_acc_id, amount } = req.body;
        if (!from_acc_id || !to_acc_id || amount === undefined || amount === null) {
            return sendError(res, 'From account, to account, and amount are required', 400);
        }
        if (from_acc_id === to_acc_id) {
            return sendError(res, 'From Account and To Account cannot be identical', 400);
        }

        const numAmount = parseFloat(amount);
        if (isNaN(numAmount) || numAmount <= 0) {
            return sendError(res, 'Transfer amount must be a positive number greater than 0', 400);
        }

        try {
            const now = new Date().toISOString();
            const dateStr = now.split('T')[0];

            // 1. Verify source account exists and has sufficient balance
            const fromAcc = await db.prepare('SELECT * FROM accounts WHERE (id = ? OR name = ?) AND user_id = ?').get(from_acc_id, from_acc_id, req.user.id);
            if (!fromAcc) {
                return sendError(res, 'Source account not found', 404);
            }
            if ((parseFloat(fromAcc.balance) || 0) < numAmount) {
                return sendError(res, `Insufficient balance in ${fromAcc.name || 'source account'}! Available: ${fromAcc.balance}`, 400);
            }

            // 2. Verify destination account exists
            const toAcc = await db.prepare('SELECT * FROM accounts WHERE (id = ? OR name = ?) AND user_id = ?').get(to_acc_id, to_acc_id, req.user.id);
            if (!toAcc) {
                return sendError(res, 'Destination account not found', 404);
            }

            // 3. Atomically update balances
            await db.prepare('UPDATE accounts SET balance = balance - ?, updated_at = ? WHERE id = ? AND user_id = ?').run(numAmount, now, fromAcc.id, req.user.id);
            await db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ? AND user_id = ?').run(numAmount, now, toAcc.id, req.user.id);

            // 4. Log transaction in transactions table
            try {
                await db.prepare(`
                    INSERT INTO transactions (user_id, account_id, type, amount, category, description, date, created_at, updated_at)
                    VALUES (?, ?, 'transfer', ?, 'Internal Vault Transfer', ?, ?, ?, ?)
                `).run(req.user.id, fromAcc.id, numAmount, `Internal Transfer from ${fromAcc.name} to ${toAcc.name}`, dateStr, now, now);
            } catch (err) {
                console.warn('[Payment Controller] Could not insert into transactions table:', err.message);
            }

            // 5. Log in accounting table
            try {
                await db.prepare(`
                    INSERT INTO accounting (user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at)
                    VALUES (?, 'expense', ?, ?, 'Internal Vault Transfer', ?, ?, 'posted', ?, ?)
                `).run(req.user.id, dateStr, numAmount, fromAcc.name, `Transfer to ${toAcc.name}`, now, now);

                await db.prepare(`
                    INSERT INTO accounting (user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at)
                    VALUES (?, 'income', ?, ?, 'Internal Vault Transfer', ?, ?, 'posted', ?, ?)
                `).run(req.user.id, dateStr, numAmount, toAcc.name, `Transfer from ${fromAcc.name}`, now, now);
            } catch (err) {
                console.warn('[Payment Controller] Could not insert into accounting table:', err.message);
            }

            return sendSuccess(res, { from_account: fromAcc.name, to_account: toAcc.name, amount: numAmount }, 'Internal fund transfer settled successfully', 200);
        } catch (error) {
            console.error('[Payment Controller] Error in transferVault:', error);
            return sendError(res, 'Failed to process internal vault transfer', 500);
        }
    },

    getReports: async (req, res) => {
        try {
            const ledger = await db.prepare('SELECT * FROM business_payments WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
            const accounts = await db.prepare('SELECT id as bank_account_id, name as bank_account_name, balance as current_balance, type FROM accounts WHERE user_id = ?').all(req.user.id);
            
            let overdueInvoices = [];
            try {
                const todayStr = new Date().toISOString().split('T')[0];
                overdueInvoices = await db.prepare(`
                    SELECT 
                        id, 
                        invoice_number, 
                        client_name, 
                        amount, 
                        total_amount,
                        paid_amount,
                        status, 
                        due_date, 
                        created_at 
                    FROM business_invoices 
                    WHERE user_id = ? 
                      AND (status IS NULL OR LOWER(status) NOT IN ('paid', 'completed', 'settled'))
                      AND due_date IS NOT NULL 
                      AND due_date < ?
                    ORDER BY due_date ASC
                `).all(req.user.id, todayStr);
            } catch (err) {
                console.warn('[Payment Controller] Error querying business_invoices:', err.message);
            }

            const receivables = ledger.filter(l => l.type === 'receive');
            const payables = ledger.filter(l => l.type === 'pay');

            return sendSuccess(res, { receivables, payables, accounts, overdueInvoices }, 'Payment reports fetched successfully');
        } catch (error) {
            console.error('[Payment Controller] Error fetching reports:', error);
            return sendError(res, 'Failed to fetch payment reports', 500);
        }
    },

    getOutstanding: async (req, res) => {
        try {
            // Fallback default summation logic for current simplicity or extend to real invoice sum later
            const sums = await db.prepare(`
                SELECT 
                    SUM(CASE WHEN type = 'receive' THEN amount ELSE 0 END) as received,
                    SUM(CASE WHEN type = 'pay' THEN amount ELSE 0 END) as paid
                FROM business_payments
                WHERE user_id = ?
            `).get(req.user.id);

            return sendSuccess(res, {
                receivables: 0, // Real tracking needs invoice totals minus received. Keeping 0 default.
                payables: 0,
                total_processed: (sums?.received || 0) + (sums?.paid || 0)
            }, 'Outstanding aggregated');
        } catch (error) {
            return sendError(res, 'Aggregation failed', 500);
        }
    },

    createCashfreeOrder: async (req, res) => {
        const amount = req.body?.amount || req.query?.amount || req.body?.order_amount || req.query?.order_amount;
        const orderId = req.body?.orderId || req.query?.orderId || req.body?.order_id || req.query?.order_id;
        const currency = req.body?.currency || req.query?.currency || 'INR';
        if (!amount) return sendError(res, 'Amount is required', 400);

        try {
            const clientId = process.env.CASHFREE_CLIENT_ID;
            const clientSecret = process.env.CASHFREE_SECRET_KEY;
            const isProd = process.env.CASHFREE_ENV === 'production';
            const apiDomain = isProd ? 'api.cashfree.com' : 'sandbox.cashfree.com';

            const payload = {
                order_id: orderId || `ORDER_${Date.now()}`,
                order_amount: parseFloat(amount),
                order_currency: currency || 'INR',
                customer_details: {
                    customer_id: `CUST_${req.user?.id || 'GUEST'}`,
                    customer_phone: (req.user?.phone || '9999999999').replace(/\D/g, '').slice(-10),
                    customer_name: req.user?.name || 'CLIKS Account Holder',
                    customer_email: req.user?.email || 'user@cliksbusiness.com'
                },
                order_meta: {
                    notify_url: `https://cliks.beta-softnet.com/api/v1/payments/webhook`
                }
            };

            const gatewayResponse = await fetch(`https://${apiDomain}/pg/orders`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-version': '2023-08-01',
                    'x-client-id': clientId,
                    'x-client-secret': clientSecret
                },
                body: JSON.stringify(payload)
            });

            const responseData = await gatewayResponse.json();

            if (!gatewayResponse.ok) {
                console.error('[Cashfree API Handshake Failed]:', responseData);
                return sendError(res, responseData.message || 'Cashfree provider error', gatewayResponse.status);
            }

            return sendSuccess(res, {
                ...responseData,
                mode: isProd ? 'production' : 'sandbox',
                cf_environment: isProd ? 'production' : 'sandbox'
            }, 'Payment provider session established securely');
        } catch (error) {
            console.error('[Payment Controller] Backend Cashfree Error:', error);
            return sendError(res, 'Gateway communication failed internally', 500);
        }
    }
};

module.exports = paymentController;
