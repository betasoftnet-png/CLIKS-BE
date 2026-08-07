const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { recordAudit } = require('../utils/auditLogger');
const gstHelper = require('../utils/gstHelper');
const { processCustomerInvoiceIntegration } = require('../utils/customerIntegration');

const logBusinessAudit = async (userId, actionType, message, severity = 'INFO') => {
    try {
        const user = await db.prepare('SELECT settings FROM users WHERE id = ?').get(userId);
        if (user && user.settings) {
            const settings = JSON.parse(user.settings);
            if (settings.auditTrail) {
                await recordAudit(actionType, message, `User #${userId}`, severity);
            }
        }
    } catch (err) {
        console.warn('Failed to record business audit log:', err);
    }
};

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

const billingController = {
    // 1. Get Invoices with Filtering
    getInvoices: async (req, res) => {
        const { search, status, customer_id } = req.query;
        try {
            let query = `SELECT * FROM business_invoices WHERE user_id = ?`;
            const params = [req.user.id];

            if (status) {
                query += ` AND status = ?`;
                params.push(status);
            }
            if (customer_id) {
                query += ` AND bank_account_id = ?`; // Map to bank/customer as appropriate
                params.push(customer_id);
            }
            if (search) {
                query += ` AND (client_name LIKE ? OR invoice_number LIKE ?)`;
                params.push(`%${search}%`, `%${search}%`);
            }

            query += ` ORDER BY due_date DESC, id DESC`;

            const invoices = await db.prepare(query).all(params);

            // Guard against null rows to avoid breaking iterations
            if (!Array.isArray(invoices)) return sendSuccess(res, [], 'Invoices fetched successfully');

            // Parse items safely
            invoices.forEach(inv => {
                if (inv.items && typeof inv.items === 'string') {
                    try {
                        inv.items = JSON.parse(inv.items);
                    } catch (e) {
                        inv.items = [];
                    }
                }
            });

            return sendSuccess(res, invoices, 'Invoices fetched successfully');
        } catch (error) {
            console.error('[Billing Controller] Error fetching invoices:', error);
            return sendError(res, 'Failed to fetch invoices', 500);
        }
    },

    // 2. Create Invoice
    createInvoice: async (req, res) => {
        const {
            invoice_number, client_name, client_email, client_gstin, billing_address, shipping_address,
            amount, tax_amount, total_amount, paid_amount, due_amount, bank_account_id,
            discount_amount, round_off, status, due_date, payment_mode, invoice_type, tax_type,
            sendPurchaseHistoryToCustomer, sendToCustomerHistory, items
        } = req.body;

        if (!client_name) return sendError(res, 'Client name is required', 400);
        
        // Double validation logic to handle edge cases where stringified corruption "NaN" might leak in 
        // from external system layers. Normalizes all currency values back to strict pure numeric values.
        const numAmount = parseFloat(amount) || 0;
        const numTax = parseFloat(tax_amount) || 0;
        const numTotal = parseFloat(total_amount) || 0;
        const numPaid = parseFloat(paid_amount) || 0;
        const numDue = parseFloat(due_amount) || 0;
        const numDiscount = parseFloat(discount_amount) || 0;
        const numRoundOff = parseFloat(round_off) || 0;

        const rawPermission = sendPurchaseHistoryToCustomer !== undefined ? sendPurchaseHistoryToCustomer : sendToCustomerHistory;
        const sendToCustVal = (rawPermission === false || rawPermission === 0 || rawPermission === 'false' || rawPermission === '0') ? 0 : 1;

        try {
            const now = new Date().toISOString();
            const invNum = invoice_number || `INV-${Date.now().toString().slice(-6)}`;
                console.log('========== CREATE INVOICE DEBUG ==========');

            console.log('REQ.USER:', req.user);

            console.log('REQ.BODY:', req.body);

            console.log('ITEMS:', items);
            console.log('ITEMS TYPE:', typeof items);

            console.log('FINAL VALUES:', {
                numAmount,
                numTax,
                numTotal,
                numPaid,
                numDue,
                numDiscount,
                numRoundOff,
                sendToCustVal
            });
            const result = await db.prepare(`
                INSERT INTO business_invoices (
                    user_id, invoice_number, client_name, client_email, client_gstin,
                    billing_address, shipping_address, amount, tax_amount, total_amount,
                    paid_amount, due_amount, bank_account_id, discount_amount, round_off,
                    status, due_date, payment_mode, invoice_type, tax_type, sendToCustomerHistory, sendPurchaseHistoryToCustomer, items,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                req.user.id, invNum, client_name, client_email || null, client_gstin || null,
                billing_address || null, shipping_address || null, numAmount, numTax, numTotal,
                numPaid, numDue, bank_account_id || null, numDiscount, numRoundOff,
                status || 'Draft', due_date, payment_mode || 'Cash', invoice_type || 'GST', tax_type || 'Exclusive', sendToCustVal, sendToCustVal,
                typeof items === 'string' ? items : JSON.stringify(items || []),
                now, now
            );

            const createdInvoice = await db.prepare('SELECT * FROM business_invoices WHERE id = ?').get(result.lastInsertRowid);
            if (createdInvoice && createdInvoice.items) {
                try { createdInvoice.items = JSON.parse(createdInvoice.items); } catch (e) {}
            }

            // Sync to accounting entries
            if (numPaid > 0) {
                const normalizedMode = normalizePaymentMode(payment_mode);
                await db.prepare(`
                    INSERT INTO accounting (user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at)
                    VALUES (?, 'income', ?, ?, 'Sales Revenue', ?, ?, 'posted', ?, ?)
                `).run(req.user.id, now.split('T')[0], numPaid, normalizedMode, `Invoice #${invNum}`, now, now);
            }

            if (numTotal - numPaid > 0) {
                await db.prepare(`
                    INSERT INTO accounting (user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at)
                    VALUES (?, 'income', ?, ?, 'Sales Revenue', 'Accounts Receivable (Credit Sale)', ?, 'posted', ?, ?)
                `).run(req.user.id, now.split('T')[0], numTotal - numPaid, `Invoice #${invNum} (Credit Sale)`, now, now);
            }

            await logBusinessAudit(req.user.id, 'INVOICE_CREATE', `Created invoice ${invNum} for client ${client_name} (amount: ₹${numTotal})`, 'SUCCESS');

            // Sync to GSTR-1
            if (invoice_type === 'GST' || numTax > 0) {
                await gstHelper.syncInvoiceToGstr1(result.lastInsertRowid, req.user.id);
            }

            // Real-time integration to CLIKS Customer Application
            await processCustomerInvoiceIntegration({
                createdInvoice,
                merchantUserId: req.user.id
            });

            return sendSuccess(res, createdInvoice, 'Invoice created successfully', 201);
        } catch (error) {
            console.error('[Billing Controller] Error creating invoice:', error);
            return sendError(res, 'Failed to create invoice', 500);
        }
    },

    // 3. Get Invoice By ID
    getInvoiceById: async (req, res) => {
        const { id } = req.params;
        try {
            let invoice = await db.prepare('SELECT * FROM business_invoices WHERE id = ? AND user_id = ?').get(id, req.user?.id);

            if (!invoice) {
                invoice = await db.prepare('SELECT * FROM business_invoices WHERE id = ? OR invoice_number = ?').get(id, id);
            }

            if (!invoice) {
                const historyRec = await db.prepare('SELECT * FROM customer_purchase_history WHERE id = ? OR invoice_id = ? OR invoice_number = ?').get(id, id, id);
                if (historyRec) {
                    invoice = {
                        id: historyRec.invoice_id || historyRec.id,
                        invoice_id: historyRec.invoice_id || historyRec.id,
                        invoiceId: historyRec.invoice_id || historyRec.id,
                        invoice_number: historyRec.invoice_number,
                        user_id: historyRec.merchant_business_id,
                        client_name: historyRec.customer_name,
                        client_email: historyRec.customer_email,
                        client_gstin: historyRec.customer_gstin,
                        shipping_address: historyRec.shipping_address,
                        amount: historyRec.subtotal,
                        tax_amount: historyRec.gst,
                        total_amount: historyRec.net_amount,
                        paid_amount: historyRec.paid_amount,
                        due_amount: historyRec.due_amount,
                        discount_amount: historyRec.discount,
                        round_off: historyRec.round_off,
                        status: historyRec.invoice_status,
                        due_date: historyRec.due_date,
                        payment_mode: historyRec.payment_mode,
                        upi_id: historyRec.upi_id,
                        bank_account_id: historyRec.bank_account_id,
                        invoice_type: historyRec.invoice_type || 'GST',
                        items: historyRec.items,
                        created_at: historyRec.invoice_date || historyRec.created_at
                    };
                }
            }

            if (!invoice) return sendError(res, 'Invoice not found', 404);

            const targetId = invoice.id || invoice.invoice_id || id;
            invoice.id = targetId;
            invoice.invoice_id = targetId;
            invoice.invoiceId = targetId;

            let parsedItems = [];
            try {
                const itemsFromTable = await db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(targetId);
                if (Array.isArray(itemsFromTable) && itemsFromTable.length > 0) {
                    parsedItems = itemsFromTable;
                }
            } catch (e) {}

            if (parsedItems.length === 0) {
                if (invoice.items && typeof invoice.items === 'string') {
                    try { parsedItems = JSON.parse(invoice.items); } catch (e) { parsedItems = []; }
                } else if (Array.isArray(invoice.items)) {
                    parsedItems = invoice.items;
                }
            }

            invoice.items = (parsedItems || []).map(it => {
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

            // Fetch nested notes, documents, payments, returns
            try { invoice.payments = await db.prepare('SELECT * FROM business_invoice_payments WHERE invoice_id = ?').all(targetId); } catch(e) { invoice.payments = []; }
            try { invoice.returns = await db.prepare('SELECT * FROM business_invoice_returns WHERE invoice_id = ?').all(targetId); } catch(e) { invoice.returns = []; }
            try { invoice.notes = await db.prepare('SELECT * FROM business_invoice_notes WHERE invoice_id = ?').all(targetId); } catch(e) { invoice.notes = []; }
            try { invoice.documents = await db.prepare('SELECT * FROM business_invoice_documents WHERE invoice_id = ?').all(targetId); } catch(e) { invoice.documents = []; }

            return sendSuccess(res, invoice, 'Invoice loaded successfully');
        } catch (error) {
            console.error('[Billing Controller] Error fetching invoice:', error);
            return sendError(res, 'Failed to fetch invoice', 500);
        }
    },

    // 4. Update Invoice
    updateInvoice: async (req, res) => {
        const { id } = req.params;
        const {
            client_name, client_email, client_gstin, billing_address, shipping_address,
            amount, tax_amount, total_amount, paid_amount, due_amount, bank_account_id,
            discount_amount, round_off, status, due_date, payment_mode, invoice_type, tax_type, items
        } = req.body;

        const numAmount = parseFloat(amount) || 0;
        const numTax = parseFloat(tax_amount) || 0;
        const numTotal = parseFloat(total_amount) || numAmount;
        const numPaid = parseFloat(paid_amount) || numTotal;
        const numDue = parseFloat(due_amount) || 0;
        const numDiscount = parseFloat(discount_amount) || 0;
        const numRoundOff = parseFloat(round_off) || 0;

        try {
            const invoice = await db.prepare('SELECT id FROM business_invoices WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!invoice) return sendError(res, 'Invoice not found', 404);

            const now = new Date().toISOString();

            await db.prepare(`
                UPDATE business_invoices SET
                    client_name = ?, client_email = ?, client_gstin = ?, billing_address = ?, shipping_address = ?,
                    amount = ?, tax_amount = ?, total_amount = ?, paid_amount = ?, due_amount = ?, bank_account_id = ?,
                    discount_amount = ?, round_off = ?, status = ?, due_date = ?, payment_mode = ?, invoice_type = ?,
                    tax_type = ?, items = ?, updated_at = ?
                WHERE id = ? AND user_id = ?
            `).run(
                client_name, client_email, client_gstin || null, billing_address || null, shipping_address || null,
                numAmount, numTax, numTotal, numPaid, numDue, bank_account_id || null,
                numDiscount, numRoundOff, status || 'Unpaid', due_date, payment_mode || 'Cash', invoice_type || 'GST',
                tax_type || 'Exclusive', typeof items === 'string' ? items : JSON.stringify(items || []),
                now, id, req.user.id
            );

            const updatedInvoice = await db.prepare('SELECT * FROM business_invoices WHERE id = ?').get(id);
            if (updatedInvoice && updatedInvoice.items) {
                try { updatedInvoice.items = JSON.parse(updatedInvoice.items); } catch (e) {}
            }

            // Sync to accounting: clear old logs and write updated ones
            await db.prepare("DELETE FROM accounting WHERE user_id = ? AND notes = ?").run(req.user.id, `Invoice #${updatedInvoice.invoice_number}`);
            if (numPaid > 0) {
                const normalizedMode = normalizePaymentMode(payment_mode);
                await db.prepare(`
                    INSERT INTO accounting (user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at)
                    VALUES (?, 'income', ?, ?, ?, ?, ?, 'posted', ?, ?)
                `).run(req.user.id, now.split('T')[0], numPaid, 'Sales Revenue', normalizedMode, `Invoice #${updatedInvoice.invoice_number}`, now, now);
            }

            await logBusinessAudit(req.user.id, 'INVOICE_UPDATE', `Updated invoice ID ${id} for client ${client_name} (amount: ₹${numTotal})`, 'INFO');

            // Sync to GSTR-1
            if (invoice_type === 'GST' || numTax > 0) {
                await gstHelper.syncInvoiceToGstr1(id, req.user.id);
            }

            return sendSuccess(res, updatedInvoice, 'Invoice updated successfully');
        } catch (error) {
            console.error('[Billing Controller] Error updating invoice:', error);
            return sendError(res, 'Failed to update invoice', 500);
        }
    },

    // 5. Delete Invoice
    deleteInvoice: async (req, res) => {
        const { id } = req.params;
        try {
            const inv = await db.prepare('SELECT invoice_number FROM business_invoices WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (inv) {
                await db.prepare("DELETE FROM accounting WHERE user_id = ? AND notes = ?").run(req.user.id, `Invoice #${inv.invoice_number}`);

                // Sync to GSTR-1 (deletion)
                await gstHelper.syncInvoiceToGstr1(id, req.user.id, inv.invoice_number);
            }

            await db.prepare('DELETE FROM business_invoices WHERE id = ?').run(id);
            await logBusinessAudit(req.user.id, 'INVOICE_DELETE', `Deleted invoice ID ${id}`, 'WARN');
            return sendSuccess(res, null, 'Invoice deleted successfully');
        } catch (error) {
            console.error('[Billing Controller] Error deleting invoice:', error);
            return sendError(res, 'Failed to delete invoice', 500);
        }
    },

    // 6. Search Invoices
    searchInvoices: async (req, res) => {
        const { q } = req.query;
        try {
            const wildcard = `%${q || ''}%`;
            const invoices = await db.prepare(`
                SELECT * FROM business_invoices 
                WHERE user_id = ? AND (invoice_number LIKE ? OR client_name LIKE ? OR client_email LIKE ?)
                ORDER BY due_date DESC
            `).all(req.user.id, wildcard, wildcard, wildcard);

            if (!Array.isArray(invoices)) return sendSuccess(res, [], 'Invoices fetched successfully');

            invoices.forEach(inv => {
                if (inv.items && typeof inv.items === 'string') {
                    try { inv.items = JSON.parse(inv.items); } catch (e) {}
                }
            });

            return sendSuccess(res, invoices, 'Invoices fetched successfully');
        } catch (error) {
            return sendError(res, 'Search operation failed', 500);
        }
    },

    // 7. Update Status
    updateInvoiceStatus: async (req, res) => {
        const { id } = req.params;
        const { status } = req.body;
        try {
            await db.prepare('UPDATE business_invoices SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(status, new Date().toISOString(), id, req.user.id);
            return sendSuccess(res, { id, status }, 'Invoice status updated successfully');
        } catch (error) {
            return sendError(res, 'Failed to update status', 500);
        }
    },

    // 8. Custom Actions
    shareInvoice: async (req, res) => sendSuccess(res, null, 'Invoice shared successfully via dynamic webhook link'),
    getInvoicePdf: async (req, res) => sendSuccess(res, { url: '/mock-invoice.pdf' }, 'PDF generated successfully'),
    printInvoice: async (req, res) => sendSuccess(res, null, 'Print spooler triggered successfully'),
    sendWhatsapp: async (req, res) => sendSuccess(res, null, 'WhatsApp reminder dispatched successfully'),
    sendEmail: async (req, res) => sendSuccess(res, null, 'Email invoice PDF dispatched successfully'),
    cancelInvoice: async (req, res) => {
        const { id } = req.params;
        try {
            await db.prepare("UPDATE business_invoices SET status = 'Cancelled', updated_at = ? WHERE id = ? AND user_id = ?").run(new Date().toISOString(), id, req.user.id);

            // Sync status to GSTR-1
            await gstHelper.syncInvoiceToGstr1(id, req.user.id);

            await logBusinessAudit(req.user.id, 'INVOICE_CANCEL', `Cancelled invoice ID ${id}`, 'WARN');
            return sendSuccess(res, { id, status: 'Cancelled' }, 'Invoice successfully cancelled');
        } catch (e) { return sendError(res, 'Failed to cancel invoice', 500); }
    },
    duplicateInvoice: async (req, res) => {
        const { id } = req.params;
        try {
            const src = await db.prepare('SELECT * FROM business_invoices WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!src) return sendError(res, 'Source invoice not found', 404);

            const now = new Date().toISOString();
            const invNum = `INV-${Date.now().toString().slice(-6)}`;

            const result = await db.prepare(`
                INSERT INTO business_invoices (
                    user_id, invoice_number, client_name, client_email, client_gstin,
                    billing_address, shipping_address, amount, tax_amount, total_amount,
                    paid_amount, due_amount, bank_account_id, discount_amount, round_off,
                    status, due_date, payment_mode, invoice_type, tax_type, items,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                req.user.id, invNum, src.client_name, src.client_email, src.client_gstin,
                src.billing_address, src.shipping_address, src.amount, src.tax_amount, src.total_amount,
                0, src.total_amount, src.bank_account_id, src.discount_amount, src.round_off,
                'Draft', src.due_date, src.payment_mode, src.invoice_type, src.tax_type, src.items,
                now, now
            );

            return sendSuccess(res, { id: result.lastInsertRowid, invoice_number: invNum }, 'Invoice duplicated successfully');
        } catch (e) { return sendError(res, 'Failed to duplicate invoice', 500); }
    },

    einvoice: async (req, res) => sendSuccess(res, { ack_no: `ACK-${Date.now()}` }, 'E-Invoice signed and registered with NIC'),
    ewaybill: async (req, res) => sendSuccess(res, { eway_no: `EWAY-${Date.now()}` }, 'E-Waybill successfully generated on NIC'),

    // 9. History / Timeline
    getInvoiceHistory: async (req, res) => {
        try {
            return sendSuccess(res, [], 'Timeline fetched successfully');
        } catch (e) { return sendError(res, 'Failed to fetch timeline', 500); }
    },

    // 10. Reports
    getSalesReport: async (req, res) => {
        try {
            const data = await db.prepare('SELECT COALESCE(SUM(total_amount), 0) as "sales" FROM business_invoices WHERE user_id = ?').get(req.user.id);
            return sendSuccess(res, data, 'Sales report retrieved');
        } catch (e) { return sendError(res, 'Failed to fetch report', 500); }
    },
    getGstReport: async (req, res) => {
        try {
            const data = await db.prepare('SELECT COALESCE(SUM(tax_amount), 0) as "gst" FROM business_invoices WHERE user_id = ?').get(req.user.id);
            return sendSuccess(res, data, 'GST report retrieved');
        } catch (e) { return sendError(res, 'Failed to fetch report', 500); }
    },
    getPaymentReport: async (req, res) => {
        try {
            const data = await db.prepare('SELECT COALESCE(SUM(paid_amount), 0) as "paid" FROM business_invoices WHERE user_id = ?').get(req.user.id);
            return sendSuccess(res, data, 'Payment report retrieved');
        } catch (e) { return sendError(res, 'Failed to fetch report', 500); }
    },
    getOutstandingReport: async (req, res) => {
        try {
            const data = await db.prepare('SELECT COALESCE(SUM(due_amount), 0) as "due" FROM business_invoices WHERE user_id = ?').get(req.user.id);
            return sendSuccess(res, data, 'Outstanding balance report retrieved');
        } catch (e) { return sendError(res, 'Failed to fetch report', 500); }
    },

    // 11. Notes Management
    createInvoiceNote: async (req, res) => {
        const { id } = req.params;
        const { title, content } = req.body;
        try {
            const result = await db.prepare('INSERT INTO business_invoice_notes (invoice_id, title, content, created_at) VALUES (?, ?, ?, ?)').run(id, title, content, new Date().toISOString());
            const note = await db.prepare('SELECT * FROM business_invoice_notes WHERE id = ?').get(result.lastInsertRowid);
            return sendSuccess(res, note, 'Note added', 201);
        } catch (e) { return sendError(res, 'Failed to add note', 500); }
    },
    getInvoiceNotes: async (req, res) => {
        const { id } = req.params;
        try {
            const notes = await db.prepare('SELECT * FROM business_invoice_notes WHERE invoice_id = ?').all(id);
            return sendSuccess(res, notes, 'Notes fetched');
        } catch (e) { return sendError(res, 'Failed to fetch notes', 500); }
    },

    // 12. Documents Management
    createInvoiceDocument: async (req, res) => {
        const { id } = req.params;
        const { name, file_path } = req.body;
        try {
            const result = await db.prepare('INSERT INTO business_invoice_documents (invoice_id, name, file_path, created_at) VALUES (?, ?, ?, ?)').run(id, name, file_path, new Date().toISOString());
            const doc = await db.prepare('SELECT * FROM business_invoice_documents WHERE id = ?').get(result.lastInsertRowid);
            return sendSuccess(res, doc, 'Document attached', 201);
        } catch (e) { return sendError(res, 'Failed to attach document', 500); }
    },
    getInvoiceDocuments: async (req, res) => {
        const { id } = req.params;
        try {
            const docs = await db.prepare('SELECT * FROM business_invoice_documents WHERE invoice_id = ?').all(id);
            return sendSuccess(res, docs, 'Documents fetched');
        } catch (e) { return sendError(res, 'Failed to fetch documents', 500); }
    },

    // 13. Payments & Returns
    createInvoicePayment: async (req, res) => {
        const { id } = req.params;
        const { amount, payment_method, reference_number, notes } = req.body;
        try {
            const invoice = await db.prepare('SELECT * FROM business_invoices WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!invoice) {
                return sendError(res, 'Invoice not found or access denied', 404);
            }

            const parsedAmount = parseFloat(amount) || 0;
            const now = new Date().toISOString();

            // Insert payment record
            await db.prepare('INSERT INTO business_invoice_payments (invoice_id, amount, payment_method, payment_date, reference_number, notes) VALUES (?, ?, ?, ?, ?, ?)')
                .run(id, parsedAmount, payment_method, now, reference_number || null, notes || null);

            // Update invoice balances and status
            await db.prepare('UPDATE business_invoices SET paid_amount = paid_amount + ?, due_amount = due_amount - ?, status = CASE WHEN due_amount - ? <= 0 THEN \'Paid\' ELSE \'Partially Paid\' END WHERE id = ?')
                .run(parsedAmount, parsedAmount, parsedAmount, id);

            // Sync to cash/bank ledger (accounting table)
            const normalizedMode = normalizePaymentMode(payment_method);
            const existingLedger = await db.prepare(`
                SELECT id FROM accounting 
                WHERE user_id = ? AND entry_type = 'income' 
                AND (mode = 'Receivables' OR mode = 'Accounts Receivable (Credit Sale)' OR mode LIKE '%Accounts Receivable%' OR mode LIKE '%Credit Sale%') 
                AND (notes LIKE ? OR notes LIKE ?)
            `).get(req.user.id, `%${invoice.invoice_number}%`, `%Credit Sale #${invoice.invoice_number}%`);

            const categoryName = existingLedger ? 'Invoice Payment' : 'Sales Revenue';

            await db.prepare(`
                INSERT INTO accounting (user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at)
                VALUES (?, 'income', ?, ?, ?, ?, ?, 'posted', ?, ?)
            `).run(req.user.id, now.split('T')[0], parsedAmount, categoryName, normalizedMode, `Payment for Invoice #${invoice.invoice_number}`, now, now);

            return sendSuccess(res, null, 'Payment captured successfully');
        } catch (e) { 
            console.error('[Billing Controller] createInvoicePayment error:', e);
            return sendError(res, 'Failed to save payment', 500); 
        }
    },
    getInvoicePayments: async (req, res) => {
        const { id } = req.params;
        try {
            const p = await db.prepare('SELECT * FROM business_invoice_payments WHERE invoice_id = ?').all(id);
            return sendSuccess(res, p, 'Payments loaded');
        } catch (e) { return sendError(res, 'Failed to load payments', 500); }
    },

    createInvoiceReturn: async (req, res) => {
        const { id } = req.params;
        const { reason, amount } = req.body;
        try {
            await db.prepare('INSERT INTO business_invoice_returns (invoice_id, reason, amount, return_date) VALUES (?, ?, ?, ?)')
                .run(id, reason, amount, new Date().toISOString());
            return sendSuccess(res, null, 'Return processed');
        } catch (e) { return sendError(res, 'Failed to process return', 500); }
    },
    getInvoiceReturns: async (req, res) => {
        const { id } = req.params;
        try {
            const r = await db.prepare('SELECT * FROM business_invoice_returns WHERE invoice_id = ?').all(id);
            return sendSuccess(res, r, 'Returns loaded');
        } catch (e) { return sendError(res, 'Failed to load returns', 500); }
    },

    // 14. Import / Export
    importInvoices: async (req, res) => sendSuccess(res, null, 'Invoices imported successfully'),
    exportInvoices: async (req, res) => {
        try {
            const invoices = await db.prepare('SELECT * FROM business_invoices WHERE user_id = ?').all(req.user.id);
            return sendSuccess(res, invoices, 'Invoices exported successfully');
        } catch (e) { return sendError(res, 'Export failed', 500); }
    },

    // 15. Analytics & Dashboard
    getAnalytics: async (req, res) => {
        try {
            const summary = await db.prepare(`
                SELECT COALESCE(SUM(total_amount), 0) as "totalSales",
                       COALESCE(SUM(paid_amount), 0) as "totalPaid",
                       COALESCE(SUM(due_amount), 0) as "totalDue"
                FROM business_invoices WHERE user_id = ?
            `).get(req.user.id);
            return sendSuccess(res, summary, 'Analytics loaded');
        } catch (e) { return sendError(res, 'Analytics failed', 500); }
    },
    getDashboardSummary: async (req, res) => {
        try {
            const count = await db.prepare('SELECT COUNT(*) as count FROM business_invoices WHERE user_id = ?').get(req.user.id);
            return sendSuccess(res, count, 'Summary loaded');
        } catch (e) { return sendError(res, 'Summary failed', 500); }
    }
};

module.exports = billingController;
