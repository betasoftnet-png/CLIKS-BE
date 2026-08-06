const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

const customerPurchaseController = {
    // 1. Get Purchase History for authenticated customer
    getPurchaseHistory: async (req, res) => {
        try {
            const userId = req.user.id;
            const userEmail = req.user.email ? String(req.user.email).trim().toLowerCase() : '';

            const purchases = await db.prepare(`
                SELECT * FROM customer_purchase_history 
                WHERE customer_user_id = ? OR LOWER(customer_email) = ?
                ORDER BY created_at DESC, id DESC
            `).all(userId, userEmail);

            const resultList = Array.isArray(purchases) ? purchases : [];

            resultList.forEach(p => {
                p.invoiceId = p.invoice_id || p.id;
                p.invoice_id = p.invoice_id || p.id;
                if (p.items && typeof p.items === 'string') {
                    try { p.items = JSON.parse(p.items); } catch (e) { p.items = []; }
                }
            });

            return sendSuccess(res, resultList, 'Customer purchase history loaded successfully');
        } catch (error) {
            console.error('[Customer Purchase Controller] getPurchaseHistory error:', error);
            return sendError(res, 'Failed to fetch purchase history', 500);
        }
    },

    // 2. Get Single Purchase / Invoice Details by ID for customer
    getPurchaseDetailsById: async (req, res) => {
        try {
            const { id } = req.params;

            // 1. Check business_invoices table by ID or invoice_number
            let invoice = await db.prepare('SELECT * FROM business_invoices WHERE id = ? OR invoice_number = ?').get(id, id);

            // 2. Check customer_purchase_history table by ID, invoice_id, or invoice_number
            let historyRec = await db.prepare(`
                SELECT * FROM customer_purchase_history 
                WHERE id = ? OR invoice_id = ? OR invoice_number = ?
            `).get(id, id, id);

            if (!invoice && !historyRec) {
                return sendError(res, 'Invoice details not found', 404);
            }

            const targetInvoiceId = (invoice && invoice.id) || (historyRec && historyRec.invoice_id) || id;

            // Fetch items from child table `invoice_items`
            let itemsFromTable = [];
            try {
                itemsFromTable = await db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(targetInvoiceId);
            } catch (e) {}

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
                    description: desc,
                    hsn_code: it.hsn_code || it.sku || it.sku_hsn || '',
                    sku: it.hsn_code || it.sku || it.sku_hsn || '',
                    sku_hsn: it.sku_hsn || it.hsn_code || it.sku || '',
                    quantity: qty,
                    unit: it.unit || 'Pcs',
                    price: price,
                    unit_price: price,
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

            const realInvoiceId = (invoice && invoice.id) || (historyRec && (historyRec.invoice_id || historyRec.id)) || parseInt(id);

            const resultData = {
                id: realInvoiceId,
                invoiceId: realInvoiceId,
                invoice_id: realInvoiceId,
                invoice_number: (invoice && invoice.invoice_number) || (historyRec && historyRec.invoice_number) || '',
                merchant_business_id: (invoice && invoice.user_id) || (historyRec && historyRec.merchant_business_id) || 0,
                business_id: (invoice && invoice.user_id) || (historyRec && historyRec.merchant_business_id) || 0,
                merchant_name: (historyRec && historyRec.merchant_name) || 'CLIKS Merchant',
                business_name: (historyRec && historyRec.merchant_name) || 'CLIKS Merchant',
                merchant_email: (historyRec && historyRec.merchant_email) || '',
                business_email: (historyRec && historyRec.merchant_email) || '',
                merchant_logo: (historyRec && historyRec.merchant_logo) || '',
                business_logo: (historyRec && historyRec.merchant_logo) || '',
                customer_name: (historyRec && historyRec.customer_name) || (invoice && invoice.client_name) || '',
                client_name: (invoice && invoice.client_name) || (historyRec && historyRec.customer_name) || '',
                customer_email: (historyRec && historyRec.customer_email) || (invoice && invoice.client_email) || '',
                client_email: (invoice && invoice.client_email) || (historyRec && historyRec.customer_email) || '',
                customer_gstin: (invoice && invoice.client_gstin) || (historyRec && historyRec.customer_gstin) || '',
                client_gstin: (invoice && invoice.client_gstin) || (historyRec && historyRec.customer_gstin) || '',
                shipping_address: (invoice && invoice.shipping_address) || (historyRec && historyRec.shipping_address) || '',
                invoice_date: (invoice && invoice.created_at) || (historyRec && historyRec.invoice_date) || '',
                created_at: (invoice && invoice.created_at) || (historyRec && historyRec.invoice_date) || '',
                due_date: (invoice && invoice.due_date) || (historyRec && historyRec.due_date) || '',
                invoice_status: (invoice && invoice.status) || (historyRec && historyRec.invoice_status) || 'Active',
                status: (invoice && invoice.status) || (historyRec && historyRec.invoice_status) || 'Active',
                payment_status: (historyRec && historyRec.payment_status) || 'Paid',
                payment_mode: (invoice && invoice.payment_mode) || (historyRec && historyRec.payment_mode) || 'Cash',
                upi_id: (invoice && invoice.upi_id) || (historyRec && historyRec.upi_id) || '',
                bank_account: (invoice && invoice.bank_account_id) || (historyRec && historyRec.bank_account_id) || '',
                bank_account_id: (invoice && invoice.bank_account_id) || (historyRec && historyRec.bank_account_id) || '',
                subtotal: parseFloat((invoice && invoice.amount) || (historyRec && historyRec.subtotal) || 0),
                amount: parseFloat((invoice && invoice.amount) || (historyRec && historyRec.subtotal) || 0),
                discount_amount: parseFloat((invoice && invoice.discount_amount) || (historyRec && historyRec.discount) || 0),
                discount: parseFloat((invoice && invoice.discount_amount) || (historyRec && historyRec.discount) || 0),
                gst_amount: parseFloat((invoice && invoice.tax_amount) || (historyRec && historyRec.gst) || 0),
                tax_amount: parseFloat((invoice && invoice.tax_amount) || (historyRec && historyRec.gst) || 0),
                gst: parseFloat((invoice && invoice.tax_amount) || (historyRec && historyRec.gst) || 0),
                round_off: parseFloat((invoice && invoice.round_off) || (historyRec && historyRec.round_off) || 0),
                grand_total: parseFloat((invoice && invoice.total_amount) || (historyRec && historyRec.net_amount) || 0),
                total_amount: parseFloat((invoice && invoice.total_amount) || (historyRec && historyRec.net_amount) || 0),
                net_amount: parseFloat((invoice && invoice.total_amount) || (historyRec && historyRec.net_amount) || 0),
                paid_amount: parseFloat((invoice && invoice.paid_amount) || (historyRec && historyRec.paid_amount) || 0),
                due_amount: parseFloat((invoice && invoice.due_amount) || (historyRec && historyRec.due_amount) || 0),
                loyalty_points_earned: (historyRec && historyRec.points_earned) || 0,
                points_earned: (historyRec && historyRec.points_earned) || 0,
                loyalty_points_redeemed: (historyRec && historyRec.points_redeemed) || 0,
                points_redeemed: (historyRec && historyRec.points_redeemed) || 0,
                items: formattedItems
            };

            return sendSuccess(res, resultData, 'Invoice details loaded successfully');
        } catch (error) {
            console.error('[Customer Purchase Controller] getPurchaseDetailsById error:', error);
            return sendError(res, 'Failed to load invoice details', 500);
        }
    },

    // 3. Get Customer Loyalty Wallet and Transactions
    getLoyaltyWallet: async (req, res) => {
        try {
            const userId = req.user.id;

            let wallet = await db.prepare(
                'SELECT * FROM customer_loyalty_wallets WHERE user_id = ?'
            ).get(userId);

            if (!wallet) {
                const user = await db.prepare('SELECT loyalty_points FROM users WHERE id = ?').get(userId);
                const pts = (user && user.loyalty_points) || 0;
                wallet = {
                    user_id: userId,
                    points_balance: pts,
                    total_earned: pts,
                    total_redeemed: 0
                };
            }

            const transactions = await db.prepare(`
                SELECT * FROM customer_loyalty_transactions 
                WHERE user_id = ?
                ORDER BY created_at DESC, id DESC
            `).all(userId);

            return sendSuccess(res, {
                wallet,
                transactions: Array.isArray(transactions) ? transactions : []
            }, 'Loyalty wallet fetched successfully');
        } catch (error) {
            console.error('[Customer Purchase Controller] getLoyaltyWallet error:', error);
            return sendError(res, 'Failed to fetch loyalty wallet', 500);
        }
    }
};

module.exports = customerPurchaseController;
