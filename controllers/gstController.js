const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const gstHelper = require('../utils/gstHelper');

const initGstTableAndColumns = async () => {
    const columns = [
        'customer_name',
        'customer_gstin',
        'customer_state',
        'sender_name',
        'sender_gstin',
        'sender_state',
        'invoice_type',
        'place_of_supply',
        'cgst',
        'sgst',
        'igst',
        'reverse_charge',
        'total_invoice',
        'tax_type',
        'cgst_amount',
        'sgst_amount',
        'igst_amount',
        'total_tax',
        'taxable_value',
        'gst_percentage',
        'export_under_lut',
        'lut_document_path',
        'lut_file_name',
        'lut_uploaded_at',
        'lut_uploaded_by',
        'purchase_invoice_id',
        'vendor_name',
        'vendor_gstin',
        'invoice_number',
        'invoice_date',
        'gst_amount',
        'status',
        'updated_at',
        'transport_mode',
        'transporter_name',
        'transporter_gstin',
        'vehicle_number',
        'transport_distance',
        'dispatch_location',
        'delivery_location',
        'eway_bill_number',
        'is_eway_bill',
        'is_reconciliation',
        'goods_product_name',
        'goods_hsn_code',
        'goods_quantity',
        'goods_unit',
        'reference_invoice',
        'items',
        'amount',
        'eligible_itc',
        'invoice_match_status',
        'mismatch_reason',
        'reconciliation_date'
    ];
    const isPg = process.env.DB_TYPE === 'postgres';
    for (const col of columns) {
        try {
            if (isPg) {
                await db.prepare(`ALTER TABLE gst_invoices ADD COLUMN IF NOT EXISTS ${col} TEXT`).run();
            } else {
                await db.prepare(`ALTER TABLE gst_invoices ADD COLUMN ${col} TEXT`).run();
            }
        } catch (e) {
            // Column already exists
        }
    }

    // Automatically sync existing purchases to GSTR-2B and sales to GSTR-1
    try {
        const purchases = await db.prepare("SELECT id, user_id FROM business_purchases").all();
        for (const pur of purchases) {
            await gstHelper.syncPurchaseToGstr2b(pur.id, pur.user_id);
        }

        // Broad synchronization of all sales invoices to ensure GSTR-1 is always up to date
        const sales = await db.prepare("SELECT id, user_id FROM business_invoices WHERE (invoice_type = 'GST' OR invoice_type = 'Export' OR tax_amount > 0) AND invoice_number IS NOT NULL").all();
        for (const inv of sales) {
            await gstHelper.syncInvoiceToGstr1(inv.id, inv.user_id);
        }
        console.log('✅ GST Tables initialization and broad sync completed');
    } catch (e) {
        console.error('❌ [GST Controller Startup Sync] Error:', e.message);
    }
};
initGstTableAndColumns();

const gstController = {
    getSettings: async (req, res) => {
        try {
            const user = await db.prepare('SELECT settings FROM users WHERE id = ?').get(req.user.id);
            let settings = {};
            if (user && user.settings) {
                try {
                    settings = JSON.parse(user.settings);
                } catch (e) {
                    settings = {};
                }
            }
            return sendSuccess(res, {
                gstin: settings.gstin || '',
                legal_name: settings.company_name || settings.legal_name || '',
                business_type: settings.business_type || '',
                place_of_business: settings.city || settings.place_of_business || '',
                state_code: settings.state_code || ''
            }, 'GST settings fetched');
        } catch (e) {
            console.error('[GST Controller] getSettings error:', e);
            return sendError(res, `GST Settings Error: ${e.message}`, 500);
        }
    },

    getInvoices: async (req, res) => {
        try {
            const userId = req.user?.id || req.user?.userId;
            if (!userId) return sendSuccess(res, [], 'GST Invoices fetched');

            const isPg = process.env.DB_TYPE === 'postgres';

            let query = `SELECT * FROM gst_invoices WHERE user_id = ?`;
            if (isPg) {
                query += ` AND (is_eway_bill IS NOT TRUE AND COALESCE(is_eway_bill::text, 'false') NOT IN ('true','1'))`;
                query += ` AND (is_reconciliation IS NOT TRUE AND COALESCE(is_reconciliation::text, 'false') NOT IN ('true','1'))`;
            } else {
                query += ` AND (is_eway_bill IS NULL OR is_eway_bill NOT IN ('true', '1', 1))`;
                query += ` AND (is_reconciliation IS NULL OR is_reconciliation NOT IN ('true', '1', 1))`;
            }

            query += ` AND (invoice_number IS NOT NULL AND invoice_number != '')`;
            query += ` ORDER BY created_at DESC`;

            let invoices = [];
            try {
                invoices = await db.prepare(query).all(userId);
            } catch (err) {
                console.warn('[GST Controller] getInvoices fallback query used:', err.message);
                try {
                    invoices = await db.prepare(`SELECT * FROM gst_invoices WHERE user_id = ? ORDER BY id DESC`).all(userId);
                } catch (e2) {
                    invoices = [];
                }
            }
            return sendSuccess(res, invoices || [], 'GST Invoices fetched');
        } catch (e) {
            console.error('[GST Controller] getInvoices error:', e);
            return sendSuccess(res, [], 'GST Invoices fetched');
        }
    },

    generateInvoice: async (req, res) => {
        try {
            const { invoice_type, place_of_supply, taxable_value, gst_percentage, reverse_charge, client_name, customer_gstin, export_under_lut, lut_document_path, lut_file_name, lut_uploaded_at, lut_uploaded_by, sender_product_name, receiver_product_name } = req.body;
            
            // Validate required fields
            if (!client_name) {
                return sendError(res, 'Customer Name is required', 400);
            }
            if (!sender_product_name || !sender_product_name.trim()) {
                return sendError(res, 'Product Name is required', 400);
            }
            if (!receiver_product_name || !receiver_product_name.trim()) {
                return sendError(res, 'Product Name is required', 400);
            }
            if (invoice_type === 'B2B') {
                if (!customer_gstin || !customer_gstin.trim()) {
                    return sendError(res, 'Customer GSTIN is required for B2B Invoice', 400);
                }
                const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/i;
                if (!gstinRegex.test(customer_gstin.trim())) {
                    return sendError(res, 'Invalid Customer GSTIN format. Must be a 15-digit alphanumeric code matching standard GSTIN layout (e.g. 33ABCDE1234F1Z5)', 400);
                }
            }
            const taxable = parseFloat(taxable_value) || 0;
            if (taxable <= 0) {
                return sendError(res, 'Taxable Value must be greater than 0', 400);
            }
            
            const isLut = invoice_type === 'Export' && String(export_under_lut) === 'true';
            if (isLut && !lut_document_path) {
                return sendError(res, 'LUT Document is mandatory for Export under LUT/Bond', 400);
            }

            const pct = isLut ? 0 : (parseFloat(gst_percentage) || 12);
            if (![0, 5, 12, 18, 28].includes(pct)) {
                return sendError(res, 'Invalid GST Percentage', 400);
            }

            const tax = taxable * (pct / 100);
            const total = taxable + tax;
            const now = new Date().toISOString();
            
            // Determine local state code from user settings
            let sender_name = '';
            let sender_gstin = '';
            let sender_state = '';
            let stateCode = '33'; // Default to Tamil Nadu code
            const user = await db.prepare('SELECT settings FROM users WHERE id = ?').get(req.user.id);
            if (user && user.settings) {
                try {
                    const parsed = JSON.parse(user.settings);
                    sender_name = parsed.company_name || parsed.legal_name || '';
                    sender_gstin = parsed.gstin || '';
                    sender_state = parsed.state || parsed.registered_state || 'Tamil Nadu';
                    if (parsed.state_code) {
                        stateCode = parsed.state_code;
                    }
                } catch (e) {
                    // Ignore parsing error
                }
            }
            
            const isLocal = place_of_supply ? place_of_supply.startsWith(stateCode) : true;
            const cgst = isLocal ? tax / 2 : 0;
            const sgst = isLocal ? tax / 2 : 0;
            const igst = isLocal ? 0 : tax;
            
            const invoice_number = `GST-${Date.now().toString().slice(-6)}`;
            const irn = `IRN-${Date.now().toString()}`;
            
            // 1. Insert into gst_invoices
            const result = await db.prepare(`
                INSERT INTO gst_invoices (
                    user_id, invoice_number, client_name, customer_name, customer_gstin, customer_state,
                    sender_name, sender_gstin, sender_state, amount, gst_amount, 
                    invoice_type, place_of_supply, taxable_value, gst_percentage, 
                    cgst, sgst, igst, cgst_amount, sgst_amount, igst_amount, total_tax, 
                    reverse_charge, total_invoice, tax_type, irn_number, qr_status, is_eway_bill, is_reconciliation, created_at, updated_at,
                    export_under_lut, lut_document_path, lut_file_name, lut_uploaded_at, lut_uploaded_by,
                    sender_product_name, receiver_product_name
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Exclusive', ?, ?, 'false', 'false', ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                req.user.id, invoice_number, client_name, client_name, customer_gstin || null, place_of_supply || '33-Tamil Nadu',
                sender_name, sender_gstin, sender_state, total, tax,
                invoice_type || 'B2B', place_of_supply || '33-Tamil Nadu', taxable, pct,
                cgst, sgst, igst, cgst, sgst, igst, tax,
                reverse_charge || 'No', total, irn, 'Signed', now, now,
                String(export_under_lut || 'false'), lut_document_path || null, lut_file_name || null, lut_uploaded_at || null, lut_uploaded_by || req.user?.username || 'Current User',
                sender_product_name, receiver_product_name
            );

            // 2. Insert into business_invoices (Sales Register)
            const items = [{
                name: receiver_product_name || `GST B2B Sale - ${invoice_type}`,
                quantity: 1,
                price: taxable,
                gst: pct,
                total: total
            }];
            
            // Calculate due date (current date + 30 days)
            const dueDateObj = new Date();
            dueDateObj.setDate(dueDateObj.getDate() + 30);
            const due_date = dueDateObj.toISOString().split('T')[0];

            await db.prepare(`
                INSERT INTO business_invoices (
                    user_id, invoice_number, client_name, client_email, client_gstin,
                    billing_address, shipping_address, amount, tax_amount, total_amount,
                    paid_amount, due_amount, bank_account_id, discount_amount, round_off,
                    status, due_date, payment_mode, invoice_type, tax_type, items,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                req.user.id, invoice_number, client_name, null, customer_gstin || null,
                null, null, taxable, tax, total,
                0, total, null, 0, 0,
                'Unpaid', due_date, 'Credit', 'GST', 'Exclusive', JSON.stringify(items),
                now, now
            );

            // 3. Insert into accounting ledger (Accounting Ledger & Day Book)
            await db.prepare(`
                INSERT INTO accounting (user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at)
                VALUES (?, 'income', ?, ?, 'Sales Revenue', 'Accounts Receivable (Credit Sale)', ?, 'posted', ?, ?)
            `).run(
                req.user.id, now.split('T')[0], total, `e-Invoice #${invoice_number}`, now, now
            );

            // 4. Insert into customer_ledger
            let customer = await db.prepare('SELECT id FROM business_customers WHERE user_id = ? AND name = ?').get(req.user.id, client_name);
            if (!customer) {
                // Check if general Walk-in Customer exists
                customer = await db.prepare("SELECT id FROM business_customers WHERE user_id = ? AND name = 'Walk-in Customer'").get(req.user.id);
                if (!customer) {
                    const resCust = await db.prepare(`
                        INSERT INTO business_customers (user_id, name, email, phone, company, status, created_at, updated_at)
                        VALUES (?, 'Walk-in Customer', '', '', 'Walk-in Company', 'Active', ?, ?)
                    `).run(req.user.id, now, now);
                    customer = { id: resCust.lastInsertRowid };
                }
            }
            const customer_id = customer.id;

            await db.prepare(`
                INSERT INTO customer_ledger (customer_id, user_id, description, amount, type, created_at)
                VALUES (?, ?, ?, ?, 'debit', ?)
            `).run(customer_id, req.user.id, `GST e-Invoice #${invoice_number}`, total, now);

            // Update customer's total spent
            await db.prepare('UPDATE business_customers SET total_spent = total_spent + ? WHERE id = ?').run(total, customer_id);

            return sendSuccess(res, { 
                id: result.lastInsertRowid, 
                invoice_number,
                irn,
                status: 'Generated',
                qr_code: 'Signed'
            }, 'Tax Invoice successfully generated');
        } catch (e) {
            console.error('[GST Controller] generateInvoice error:', e);
            return sendError(res, `Generate Invoice Error: ${e.message}`, 500);
        }
    },

    getEways: async (req, res) => {
        try {
            const eways = await db.prepare("SELECT * FROM gst_invoices WHERE user_id = ? AND is_eway_bill = 'true'").all(req.user.id);
            return sendSuccess(res, eways, 'E-Way bills fetched');
        } catch (e) {
            console.error('[GST Controller] getEways error:', e);
            return sendError(res, `Get E-Ways Error: ${e.message}`, 500);
        }
    },

    createEway: async (req, res) => {
        try {
            const { 
                invoice_number, 
                invoice_date, 
                transport_mode,
                transporter_name, 
                transporter_gstin,
                vehicle_number, 
                transport_distance, 
                dispatch_location, 
                delivery_location,
                // Goods Details fields
                goods_product_name,
                goods_hsn_code,
                goods_quantity,
                goods_unit,
                goods_taxable_value,
                goods_gst_rate,
                goods_total_value,
                items
            } = req.body;

            // 1. Mandatory Fields Validation
            if (!invoice_number) return sendError(res, 'Invoice number is required', 400);
            if (!invoice_date) return sendError(res, 'Invoice date is required', 400);
            if (!transporter_name) return sendError(res, 'Transport company name is required', 400);
            if (!dispatch_location) return sendError(res, 'Dispatch location is required', 400);
            if (!delivery_location) return sendError(res, 'Delivery destination is required', 400);
            if (transport_distance === undefined || transport_distance === null || transport_distance === '') {
                return sendError(res, 'Transport distance is required', 400);
            }
            if (transport_mode === 'Road' && !vehicle_number) {
                return sendError(res, 'Vehicle number is required for Road transport', 400);
            }

            const eway_bill_number = `EWB-${Date.now().toString().slice(-8)}`;
            
            // 2. Prepare Data with sanitized types
            const dist = parseInt(transport_distance) || 0;
            const qty = (goods_quantity !== undefined && goods_quantity !== null && goods_quantity !== '') ? parseFloat(goods_quantity) : null;
            const taxable = (goods_taxable_value !== undefined && goods_taxable_value !== null && goods_taxable_value !== '') ? parseFloat(goods_taxable_value) : 0;
            const gstRate = (goods_gst_rate !== undefined && goods_gst_rate !== null && goods_gst_rate !== '') ? parseFloat(goods_gst_rate) : 18;
            const total = (goods_total_value !== undefined && goods_total_value !== null && goods_total_value !== '') ? parseFloat(goods_total_value) : (taxable * (1 + gstRate / 100));
            const itemsJson = items ? (typeof items === 'string' ? items : JSON.stringify(items)) : null;
            const createdAt = invoice_date || new Date().toISOString();

            // 3. Database Insertion
            const result = await db.prepare(`
                INSERT INTO gst_invoices (
                    user_id, invoice_number, transporter_name, vehicle_number, 
                    transport_distance, dispatch_location, delivery_location, 
                    status, eway_bill_number, is_eway_bill, is_reconciliation, 
                    transport_mode, transporter_gstin, 
                    goods_product_name, goods_hsn_code, goods_quantity, goods_unit,
                    taxable_value, gst_percentage, amount, items,
                    created_at, updated_at, reference_invoice
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Generated', ?, 'true', 'false', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                req.user.id,
                invoice_number,
                transporter_name,
                vehicle_number || null,
                dist,
                dispatch_location,
                delivery_location,
                eway_bill_number,
                transport_mode || 'Road',
                transporter_gstin || null,
                goods_product_name || null,
                goods_hsn_code || null,
                qty,
                goods_unit || null,
                taxable,
                gstRate,
                total,
                itemsJson,
                createdAt,
                new Date().toISOString(),
                invoice_number
            );

            // 4. Link to Sales Invoice (Update existing record if it exists)
            try {
                await db.prepare("UPDATE gst_invoices SET eway_bill_number = ?, updated_at = ? WHERE user_id = ? AND invoice_number = ? AND (is_eway_bill = 'false' OR is_eway_bill IS NULL)").run(eway_bill_number, new Date().toISOString(), req.user.id, invoice_number);
            } catch (updateErr) {
                console.warn('[GST Controller] Reference invoice update failed:', updateErr.message);
            }

            // 5. Fetch and return the created record
            const createdEway = await db.prepare("SELECT * FROM gst_invoices WHERE id = ?").get(result.lastInsertRowid);
            if (createdEway && createdEway.items && typeof createdEway.items === 'string') {
                try { createdEway.items = JSON.parse(createdEway.items); } catch (e) {}
            }

            return sendSuccess(res, createdEway, 'Government e-Way Bill generated successfully', 201);

        } catch (e) {
            console.error('[GST Controller] createEway error:', e);
            return sendError(res, `Failed to generate e-Way Bill: ${e.message}`, 500);
        }
    },

    getReconciliations: async (req, res) => {
        try {
            const reconciliations = await db.prepare("SELECT * FROM gst_invoices WHERE user_id = ? AND is_reconciliation = 'true'").all(req.user.id);
            return sendSuccess(res, reconciliations, 'Reconciliations fetched');
        } catch (e) {
            console.error('[GST Controller] getReconciliations error:', e);
            return sendError(res, `Get Reconciliations Error: ${e.message}`, 500);
        }
    },

    runReconciliation: async (req, res) => {
        try {
            const { id, vendor_gstin, vendor_name, invoice_amount, gst_rate, match_status } = req.body;
            const amt = parseFloat(invoice_amount) || 0;
            const pct = parseFloat(gst_rate) || 18;
            const tax = amt * (pct / (100 + pct));
            const taxable = amt - tax;
            
            const isLocal = vendor_gstin ? vendor_gstin.startsWith('27') : true;
            const cgst = isLocal ? tax / 2 : 0;
            const sgst = isLocal ? tax / 2 : 0;
            const igst = isLocal ? 0 : tax;
            
            const now = new Date().toISOString();

            if (id) {
                // Update existing record
                await db.prepare(`
                    UPDATE gst_invoices SET
                        vendor_gstin = ?,
                        vendor_name = ?,
                        amount = ?,
                        taxable_value = ?,
                        total_tax = ?,
                        cgst_amount = ?,
                        sgst_amount = ?,
                        igst_amount = ?,
                        eligible_itc = ?,
                        invoice_match_status = ?,
                        updated_at = ?
                    WHERE id = ? AND user_id = ?
                `).run(
                    vendor_gstin, vendor_name, amt, taxable, tax,
                    cgst, sgst, igst, tax, match_status, now, id, req.user.id
                );
                return sendSuccess(res, { id }, 'Reconciliation status updated');
            } else {
                // Insert new record
                const result = await db.prepare(`
                    INSERT INTO gst_invoices (
                        user_id, vendor_gstin, vendor_name, amount, taxable_value, total_tax,
                        cgst_amount, sgst_amount, igst_amount, eligible_itc,
                        invoice_match_status, is_reconciliation, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'true', ?, ?)
                `).run(
                    req.user.id, vendor_gstin, vendor_name, amt, taxable, tax,
                    cgst, sgst, igst, tax, match_status || 'matched', now, now
                );
                return sendSuccess(res, { id: result.lastInsertRowid }, 'Reconciliation entry added');
            }
        } catch (e) {
            console.error('[GST Controller] runReconciliation error:', e);
            return sendError(res, `Run Reconciliation Error: ${e.message}`, 500);
        }
    },

    deleteInvoice: async (req, res) => {
        try {
            const { id } = req.params;
            await db.prepare('DELETE FROM gst_invoices WHERE id = ? AND user_id = ?').run(id, req.user.id);
            return sendSuccess(res, { id }, 'Record deleted successfully');
        } catch (e) {
            console.error('[GST Controller] deleteInvoice error:', e);
            return sendError(res, `Delete Invoice Error: ${e.message}`, 500);
        }
    },

    getGSTR3B: async (req, res) => {
        try {
            const userId = req.user?.id || req.user?.userId;
            if (!userId) {
                return sendSuccess(res, {
                    outward_taxable: 0, outward_igst: 0, outward_cgst: 0, outward_sgst: 0, total_output_tax: 0,
                    eligible_itc_igst: 0, eligible_itc_cgst: 0, eligible_itc_sgst: 0, total_eligible_itc: 0,
                    net_payable_igst: 0, net_payable_cgst: 0, net_payable_sgst: 0
                }, 'GSTR-3B report fetched');
            }

            const isPg = process.env.DB_TYPE === 'postgres';
            const sum = (col) => isPg ? `SUM(COALESCE("${col}"::numeric, 0))` : `SUM(COALESCE(${col}, 0))`;
            const notEway = isPg ? `(is_eway_bill IS NOT TRUE AND is_eway_bill::text NOT IN ('true','1'))` : `(is_eway_bill = 'false' OR is_eway_bill IS NULL)`;
            const notRecon = isPg ? `(is_reconciliation IS NOT TRUE AND is_reconciliation::text NOT IN ('true','1'))` : `(is_reconciliation = 'false' OR is_reconciliation IS NULL)`;
            const isRecon = isPg ? `(is_reconciliation = true OR is_reconciliation::text IN ('true','1'))` : `is_reconciliation = 'true'`;

            let sales = null;
            try {
                sales = await db.prepare(`
                    SELECT 
                        ${sum('taxable_value')} as taxable,
                        ${sum('cgst_amount')} as cgst,
                        ${sum('sgst_amount')} as sgst,
                        ${sum('igst_amount')} as igst,
                        ${sum('total_tax')} as tax
                    FROM gst_invoices 
                    WHERE user_id = ? 
                      AND ${notEway}
                      AND ${notRecon}
                `).get(userId);
            } catch (e) {
                try {
                    sales = await db.prepare(`SELECT ${sum('taxable_value')} as taxable, ${sum('cgst_amount')} as cgst, ${sum('sgst_amount')} as sgst, ${sum('igst_amount')} as igst, ${sum('total_tax')} as tax FROM gst_invoices WHERE user_id = ?`).get(userId);
                } catch (e2) {}
            }

            let purchases = null;
            try {
                purchases = await db.prepare(`
                    SELECT 
                        ${sum('taxable_value')} as taxable,
                        ${sum('cgst_amount')} as cgst,
                        ${sum('sgst_amount')} as sgst,
                        ${sum('igst_amount')} as igst,
                        ${sum('eligible_itc')} as eligible_itc
                    FROM gst_invoices 
                    WHERE user_id = ? 
                      AND ${isRecon}
                      AND invoice_match_status = 'Verified'
                `).get(userId);
            } catch (e) {
                try {
                    purchases = await db.prepare(`SELECT ${sum('taxable_value')} as taxable, ${sum('cgst_amount')} as cgst, ${sum('sgst_amount')} as sgst, ${sum('igst_amount')} as igst FROM gst_invoices WHERE user_id = ?`).get(userId);
                } catch (e2) {}
            }

            const outward_taxable = parseFloat(sales?.taxable) || 0;
            const outward_igst = parseFloat(sales?.igst) || 0;
            const outward_cgst = parseFloat(sales?.cgst) || 0;
            const outward_sgst = parseFloat(sales?.sgst) || 0;
            const total_output_tax = parseFloat(sales?.tax) || 0;

            const eligible_itc_igst = parseFloat(purchases?.igst) || 0;
            const eligible_itc_cgst = parseFloat(purchases?.cgst) || 0;
            const eligible_itc_sgst = parseFloat(purchases?.sgst) || 0;
            const total_eligible_itc = parseFloat(purchases?.eligible_itc) || 0;

            const net_payable_igst = Math.max(0, outward_igst - eligible_itc_igst);
            const net_payable_cgst = Math.max(0, outward_cgst - eligible_itc_cgst);
            const net_payable_sgst = Math.max(0, outward_sgst - eligible_itc_sgst);

            return sendSuccess(res, {
                outward_taxable,
                outward_igst,
                outward_cgst,
                outward_sgst,
                total_output_tax,
                eligible_itc_igst,
                eligible_itc_cgst,
                eligible_itc_sgst,
                total_eligible_itc,
                net_payable_igst,
                net_payable_cgst,
                net_payable_sgst
            }, 'GSTR-3B report fetched');
        } catch (e) {
            console.error('[GST Controller] getGSTR3B error:', e);
            return sendSuccess(res, {
                outward_taxable: 0, outward_igst: 0, outward_cgst: 0, outward_sgst: 0, total_output_tax: 0,
                eligible_itc_igst: 0, eligible_itc_cgst: 0, eligible_itc_sgst: 0, total_eligible_itc: 0,
                net_payable_igst: 0, net_payable_cgst: 0, net_payable_sgst: 0
            }, 'GSTR-3B report fetched');
        }
    },

    getGSTR9: async (req, res) => {
        try {
            const userId = req.user?.id || req.user?.userId;
            const { fy } = req.query; // e.g. "2024-25"
            let startYear = 2024;
            if (fy) {
                const parts = fy.split('-');
                startYear = parseInt(parts[0]) || 2024;
            }

            const startDate = `${startYear}-04-01`;
            const endDate = `${startYear + 1}-03-31`;

            const isPg = process.env.DB_TYPE === 'postgres';
            const safeNum = (col) => isPg ? `COALESCE(NULLIF(REGEXP_REPLACE("${col}"::text, '[^0-9.]', '', 'g'), '')::numeric, 0)` : `COALESCE(${col}, 0)`;
            const sum = (col) => `SUM(${safeNum(col)})`;

            const notEway = isPg ? `(is_eway_bill IS NOT TRUE AND COALESCE(is_eway_bill::text, 'false') NOT IN ('true','1'))` : `(is_eway_bill = 'false' OR is_eway_bill IS NULL)`;
            const notRecon = isPg ? `(is_reconciliation IS NOT TRUE AND COALESCE(is_reconciliation::text, 'false') NOT IN ('true','1'))` : `(is_reconciliation = 'false' OR is_reconciliation IS NULL)`;
            const isRecon = isPg ? `(is_reconciliation = true OR COALESCE(is_reconciliation::text, 'false') IN ('true','1'))` : `is_reconciliation = 'true'`;

            const dateFilter = isPg ? `created_at::date BETWEEN ? AND ?` : `date(created_at) BETWEEN ? AND ?`;

            let sales = null;
            try {
                sales = await db.prepare(`
                    SELECT
                        ${sum('taxable_value')} as taxable,
                        ${sum('total_tax')} as tax,
                        ${sum('cgst_amount')} as cgst,
                        ${sum('sgst_amount')} as sgst,
                        ${sum('igst_amount')} as igst,
                        COUNT(*) as count
                    FROM gst_invoices
                    WHERE user_id = ?
                      AND ${notEway}
                      AND ${notRecon}
                      AND ${dateFilter}
                `).get(userId, startDate, endDate);
            } catch (err) {
                console.warn('[GST Controller] getGSTR9 sales summary fallback:', err.message);
                try {
                    sales = await db.prepare(`SELECT ${sum('taxable_value')} as taxable, ${sum('total_tax')} as tax FROM gst_invoices WHERE user_id = ?`).get(userId);
                } catch (e2) {}
            }

            let purchases = null;
            try {
                purchases = await db.prepare(`
                    SELECT
                        ${sum('taxable_value')} as taxable,
                        ${sum('total_tax')} as tax,
                        ${sum('cgst_amount')} as cgst,
                        ${sum('sgst_amount')} as sgst,
                        ${sum('igst_amount')} as igst,
                        ${sum('eligible_itc')} as itc,
                        COUNT(*) as count
                    FROM gst_invoices
                    WHERE user_id = ?
                      AND ${isRecon}
                      AND ${dateFilter}
                `).get(userId, startDate, endDate);
            } catch (err) {
                console.warn('[GST Controller] getGSTR9 purchases summary fallback:', err.message);
                try {
                    purchases = await db.prepare(`SELECT ${sum('taxable_value')} as taxable, ${sum('total_tax')} as tax, ${sum('eligible_itc')} as itc FROM gst_invoices WHERE user_id = ?`).get(userId);
                } catch (e2) {}
            }

            // Monthly Filing Summary
            const monthlyData = [];
            for (let i = 0; i < 12; i++) {
                const monthDate = new Date(startYear, 3 + i, 1);
                const mStart = monthDate.toISOString().split('T')[0];
                const lastDay = new Date(startYear, 3 + i + 1, 0).getDate();
                const mEnd = new Date(startYear, 3 + i, lastDay).toISOString().split('T')[0];

                let mSales = null;
                let mPurchases = null;

                try {
                    mSales = await db.prepare(`
                        SELECT ${sum('taxable_value')} as taxable, ${sum('total_tax')} as tax
                        FROM gst_invoices WHERE user_id = ? AND ${notEway} AND ${notRecon} AND ${dateFilter}
                    `).get(userId, mStart, mEnd);
                } catch (e) {}

                try {
                    mPurchases = await db.prepare(`
                        SELECT ${sum('taxable_value')} as taxable, ${sum('total_tax')} as tax, ${sum('eligible_itc')} as itc
                        FROM gst_invoices WHERE user_id = ? AND ${isRecon} AND ${dateFilter}
                    `).get(userId, mStart, mEnd);
                } catch (e) {}

                const salesTaxable = parseFloat(mSales?.taxable) || 0;
                const salesTax = parseFloat(mSales?.tax) || 0;
                const purTaxable = parseFloat(mPurchases?.taxable) || 0;
                const purItc = parseFloat(mPurchases?.itc) || 0;

                monthlyData.push({
                    month: monthDate.toLocaleString('default', { month: 'long', year: 'numeric' }),
                    sales: salesTaxable,
                    purchases: purTaxable,
                    output_gst: salesTax,
                    itc: purItc,
                    gst_paid: Math.max(0, salesTax - purItc),
                    gstr1_status: salesTaxable > 0 ? 'Filed' : 'Not Required',
                    gstr3b_status: (salesTaxable > 0 || purItc > 0) ? 'Filed' : 'Not Required'
                });
            }

            const payments = monthlyData
                .filter(m => m.gst_paid > 0)
                .map((m, idx) => ({
                    date: new Date(startYear, 3 + monthlyData.indexOf(m) + 1, 20).toISOString().split('T')[0],
                    challan: `CPIN${startYear}${idx.toString().padStart(6, '0')}`,
                    period: m.month,
                    amount: m.gst_paid,
                    status: 'Paid'
                }));

            return sendSuccess(res, {
                summary: {
                    total_taxable_sales: parseFloat(sales?.taxable) || 0,
                    total_taxable_purchases: parseFloat(purchases?.taxable) || 0,
                    total_output_gst: parseFloat(sales?.tax) || 0,
                    total_itc_availed: parseFloat(purchases?.itc) || 0,
                    net_gst_paid: Math.max(0, (parseFloat(sales?.tax) || 0) - (parseFloat(purchases?.itc) || 0)),
                    credit_notes: 0,
                    debit_notes: 0,
                    export_sales: 0,
                    exempt_sales: 0,
                    reverse_charge_purchases: 0,
                    refunds: 0
                },
                monthly_filings: monthlyData,
                payment_history: payments,
                fiscal_year: fy || `FY ${startYear}-${(startYear + 1).toString().slice(-2)}`,
                status: 'Draft'
            }, 'GSTR-9 annual return compiled');
        } catch (e) {
            console.error('[GST Controller] getGSTR9 error:', e);
            return sendSuccess(res, {
                summary: {
                    total_taxable_sales: 0, total_taxable_purchases: 0, total_output_gst: 0,
                    total_itc_availed: 0, net_gst_paid: 0, credit_notes: 0, debit_notes: 0,
                    export_sales: 0, exempt_sales: 0, reverse_charge_purchases: 0, refunds: 0
                },
                monthly_filings: [], payment_history: [], fiscal_year: '2024-25', status: 'Draft'
            }, 'GSTR-9 annual return compiled');
        }
    },

    getPublicInvoice: async (req, res) => {
        const { id } = req.params;
        try {
            const invoice = await db.prepare('SELECT * FROM gst_invoices WHERE id = ?').get(id);
            if (!invoice) return sendError(res, 'Invoice not found', 404);
            return sendSuccess(res, invoice, 'Public invoice details retrieved');
        } catch (e) {
            console.error('[GST Controller] getPublicInvoice error:', e);
            return sendError(res, `Public Invoice Details Error: ${e.message}`, 500);
        }
    }
};

module.exports = gstController;
