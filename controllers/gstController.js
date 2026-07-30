const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

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
            const invoices = await db.prepare("SELECT * FROM gst_invoices WHERE user_id = ? AND (is_eway_bill = 'false' OR is_eway_bill IS NULL) AND (is_reconciliation = 'false' OR is_reconciliation IS NULL)").all(req.user.id);
            return sendSuccess(res, invoices, 'GST Invoices fetched');
        } catch (e) {
            console.error('[GST Controller] getInvoices error:', e);
            return sendError(res, `Get Invoices Error: ${e.message}`, 500);
        }
    },

    generateInvoice: async (req, res) => {
        try {
            const { invoice_type, place_of_supply, taxable_value, gst_percentage, reverse_charge, client_name, customer_gstin } = req.body;
            const taxable = parseFloat(taxable_value) || 0;
            const pct = parseFloat(gst_percentage) || 18;
            const tax = taxable * (pct / 100);
            const total = taxable + tax;
            
            // Determine local state code from user settings
            let stateCode = '33'; // Default to Tamil Nadu code
            const user = await db.prepare('SELECT settings FROM users WHERE id = ?').get(req.user.id);
            if (user && user.settings) {
                try {
                    const parsed = JSON.parse(user.settings);
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
            
            const result = await db.prepare(`
                INSERT INTO gst_invoices (
                    user_id, invoice_number, client_name, customer_gstin, amount, gst_amount, 
                    invoice_type, place_of_supply, taxable_value, gst_percentage, 
                    cgst_amount, sgst_amount, igst_amount, total_tax, 
                    reverse_charge, irn_number, qr_status, is_eway_bill, is_reconciliation, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'false', 'false', ?)
            `).run(
                req.user.id, invoice_number, client_name || 'Client Name', customer_gstin || null, total, tax,
                invoice_type || 'B2B', place_of_supply || '33-Tamil Nadu', taxable, pct,
                cgst, sgst, igst, tax,
                reverse_charge || 'No', irn, 'Signed', new Date().toISOString()
            );

            return sendSuccess(res, { id: result.lastInsertRowid, invoice_number }, 'Tax Invoice successfully generated');
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
                    created_at, reference_invoice
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Generated', ?, 'true', 'false', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                invoice_number
            );

            // 4. Link to Sales Invoice (Update existing record if it exists)
            try {
                await db.prepare("UPDATE gst_invoices SET eway_bill_number = ? WHERE user_id = ? AND invoice_number = ? AND (is_eway_bill = 'false' OR is_eway_bill IS NULL)").run(eway_bill_number, req.user.id, invoice_number);
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
            const { vendor_gstin, vendor_name, invoice_amount, gst_rate, match_status } = req.body;
            const amt = parseFloat(invoice_amount) || 0;
            const pct = parseFloat(gst_rate) || 18;
            const tax = amt * (pct / (100 + pct));
            const taxable = amt - tax;
            
            const isLocal = vendor_gstin ? vendor_gstin.startsWith('27') : true;
            const cgst = isLocal ? tax / 2 : 0;
            const sgst = isLocal ? tax / 2 : 0;
            const igst = isLocal ? 0 : tax;
            
            const result = await db.prepare(`
                INSERT INTO gst_invoices (
                    user_id, vendor_gstin, vendor_name, amount, taxable_value, total_tax,
                    cgst_amount, sgst_amount, igst_amount, eligible_itc, 
                    invoice_match_status, is_reconciliation, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'true', ?)
            `).run(
                req.user.id, vendor_gstin, vendor_name, amt, taxable, tax,
                cgst, sgst, igst, tax, match_status || 'matched', new Date().toISOString()
            );

            return sendSuccess(res, { id: result.lastInsertRowid }, 'Reconciliation entry added');
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
            const sales = await db.prepare("SELECT SUM(taxable_value) as taxable, SUM(total_tax) as tax FROM gst_invoices WHERE user_id = ? AND (is_eway_bill = 'false' OR is_eway_bill IS NULL) AND (is_reconciliation = 'false' OR is_reconciliation IS NULL)").get(req.user.id);
            const purchases = await db.prepare("SELECT SUM(taxable_value) as taxable, SUM(total_tax) as tax FROM gst_invoices WHERE user_id = ? AND is_reconciliation = 'true'").get(req.user.id);
            
            return sendSuccess(res, {
                outward_supplies: {
                    taxable_value: sales.taxable || 0,
                    total_tax: sales.tax || 0
                },
                eligible_itc: {
                    taxable_value: purchases.taxable || 0,
                    total_tax: purchases.tax || 0
                }
            }, 'GSTR-3B report fetched');
        } catch (e) {
            console.error('[GST Controller] getGSTR3B error:', e);
            return sendError(res, `GSTR-3B Error: ${e.message}`, 500);
        }
    },

    getGSTR9: async (req, res) => {
        try {
            const result = await db.prepare("SELECT SUM(amount) as total_sales, SUM(total_tax) as total_tax FROM gst_invoices WHERE user_id = ?").get(req.user.id);
            return sendSuccess(res, {
                total_sales: result.total_sales || 0,
                total_tax: result.total_tax || 0,
                status: 'Draft'
            }, 'GSTR-9 report fetched');
        } catch (e) {
            console.error('[GST Controller] getGSTR9 error:', e);
            return sendError(res, `GSTR-9 Error: ${e.message}`, 500);
        }
    }
};

module.exports = gstController;
