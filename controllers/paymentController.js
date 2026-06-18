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
