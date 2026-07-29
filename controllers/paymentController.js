const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

const initColumns = async () => {
    const columns = [
        'party_name TEXT',
        'reference_number TEXT',
        'payment_mode TEXT',
        'invoice_id TEXT',
        'notes TEXT',
        'reconciliation_status TEXT'
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
        const { amount, customer_name, invoice_id, payment_mode, reference_number, notes } = req.body;
        if (!amount) return sendError(res, 'Amount is required', 400);
        try {
            const now = new Date().toISOString();
            const result = await db.prepare(
                `INSERT INTO business_payments (user_id, type, amount, party_name, invoice_id, payment_mode, reference_number, notes, status, reconciliation_status, created_at)
                 VALUES (?, 'receive', ?, ?, ?, ?, ?, ?, 'completed', 'matched', ?)`
            ).run(req.user.id, amount, customer_name || 'General Customer', invoice_id || null, payment_mode || 'Cash', reference_number || null, notes || null, now);

            return sendSuccess(res, { id: result.lastInsertRowid, amount }, 'Payment received successfully', 201);
        } catch (error) {
            console.error('[Payment Controller] Error receiving payment:', error);
            return sendError(res, 'Failed to receive payment', 500);
        }
    },

    paySupplier: async (req, res) => {
        const { amount, supplier_name, purchase_id, payment_mode, reference_number, notes } = req.body;
        if (!amount) return sendError(res, 'Amount is required', 400);
        try {
            const now = new Date().toISOString();
            const result = await db.prepare(
                `INSERT INTO business_payments (user_id, type, amount, party_name, invoice_id, payment_mode, reference_number, notes, status, reconciliation_status, created_at)
                 VALUES (?, 'pay', ?, ?, ?, ?, ?, ?, 'completed', 'matched', ?)`
            ).run(req.user.id, amount, supplier_name || 'General Supplier', purchase_id || null, payment_mode || 'Bank Transfer', reference_number || null, notes || null, now);

            // Locate credit purchase bill using Bill Number (purchase_id)
            const purchase = await db.prepare("SELECT * FROM business_purchases WHERE user_id = ? AND (purchase_number = ? OR id = ? || 0)").get(req.user.id, purchase_id, purchase_id);
            
            if (purchase) {
                const amountVal = parseFloat(amount) || 0;
                const newPaidAmount = (parseFloat(purchase.paid_amount) || 0) + amountVal;
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

                // Update the Credit Purchase bill status and paid amount
                await db.prepare('UPDATE business_purchases SET paid_amount = ?, payment_status = ?, status = ? WHERE id = ?').run(newPaidAmount, newPaymentStatus, newStatus, purchase.id);

                // Update matching Credit Purchase in accounting ledger
                const creditLedger = await db.prepare("SELECT * FROM accounting WHERE user_id = ? AND category = 'Inventory Purchases' AND mode = 'Payables' AND notes LIKE ?").get(req.user.id, `%Purchase #${purchase.purchase_number}%`);
                if (creditLedger) {
                    const updatedStatus = newPaidAmount >= totalToPay ? 'Paid' : 'Partially Paid';
                    await db.prepare("UPDATE accounting SET status = ? WHERE id = ?").run(updatedStatus, creditLedger.id);
                }

                // Reduce Accounts Payable balance and update Cash/Bank
                const normalizePaymentMode = (mode) => {
                    if (!mode) return 'Cash in Hand';
                    const m = String(mode).toLowerCase();
                    if (m === 'cash' || m.includes('cash in hand') || m.includes('hand')) return 'Cash in Hand';
                    if (m.includes('hdfc')) return 'HDFC Bank Account';
                    if (m.includes('icici')) return 'ICICI Bank Account';
                    if (m.includes('sbi') || m.includes('state bank')) return 'SBI Current Account';
                    if (m === 'upi' || m.includes('razorpay') || m.includes('gpay') || m.includes('phonepe') || m.includes('paytm')) return 'UPI / Razorpay';
                    if (m === 'bank' || m.includes('bank')) return 'HDFC Bank Account';
                    return mode;
                };

                const normalizedMode = normalizePaymentMode(payment_mode);
                await db.prepare(`
                    INSERT INTO accounting (user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at)
                    VALUES (?, 'expense', ?, ?, 'Supplier Payment', ?, ?, 'Paid', ?, ?)
                `).run(req.user.id, now.split('T')[0], amountVal, normalizedMode, `Payment for Purchase #${purchase.purchase_number}`, now, now);
            }

            if (supplier_name) {
                await db.prepare("UPDATE business_suppliers SET outstanding_balance = outstanding_balance - ? WHERE name = ? AND user_id = ?").run(amount, supplier_name, req.user.id);
            }

            return sendSuccess(res, { id: result.lastInsertRowid, amount }, 'Payment to supplier recorded successfully', 201);
        } catch (error) {
            console.error('[Payment Controller] Error paying supplier:', error);
            return sendError(res, 'Failed to process supplier payment', 500);
        }
    },

    getReports: async (req, res) => {
        try {
            const ledger = await db.prepare('SELECT * FROM business_payments WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
            const accounts = await db.prepare('SELECT id as bank_account_id, name as bank_account_name, balance as current_balance, type FROM accounts WHERE user_id = ?').all(req.user.id);
            
            // Derive stats
            const receivables = ledger.filter(l => l.type === 'receive');
            const payables = ledger.filter(l => l.type === 'pay');

            return sendSuccess(res, { receivables, payables, accounts }, 'Payment reports fetched successfully');
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
        const { amount, orderId, currency } = req.body;
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

            return sendSuccess(res, responseData, 'Payment provider session established securely');
        } catch (error) {
            console.error('[Payment Controller] Backend Cashfree Error:', error);
            return sendError(res, 'Gateway communication failed internally', 500);
        }
    }
};

module.exports = paymentController;
