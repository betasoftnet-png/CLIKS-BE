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
                gstin: settings.gstin || '27AAAAA1111A1Z1',
                legal_name: settings.company_name || settings.legal_name || 'CLIKS Digital Services',
                business_type: settings.business_type || 'Private Limited',
                place_of_business: settings.city || settings.place_of_business || 'Maharashtra',
                state_code: settings.state_code || '27'
            }, 'GST settings fetched');
        } catch (e) {
            console.error('[GST Controller] getSettings error:', e);
            return sendError(res, 'Internal server error', 500);
        }
    },

    getInvoices: async (req, res) => {
        try {
            const invoices = await db.prepare("SELECT * FROM gst_invoices WHERE user_id = ? AND (is_eway_bill = 'false' OR is_eway_bill IS NULL) AND (is_reconciliation = 'false' OR is_reconciliation IS NULL)").all(req.user.id);
            return sendSuccess(res, invoices, 'GST Invoices fetched');
        } catch (e) {
            console.error('[GST Controller] getInvoices error:', e);
            return sendError(res, 'Internal server error', 500);
        }
    },

    generateInvoice: async (req, res) => {
        try {
            const { invoice_type, place_of_supply, taxable_value, gst_percentage, reverse_charge } = req.body;
            const taxable = parseFloat(taxable_value) || 0;
            const pct = parseFloat(gst_percentage) || 18;
            const tax = taxable * (pct / 100);
            const total = taxable + tax;
            
            const isLocal = place_of_supply ? place_of_supply.startsWith('27') : true;
            const cgst = isLocal ? tax / 2 : 0;
            const sgst = isLocal ? tax / 2 : 0;
            const igst = isLocal ? 0 : tax;
            
            const invoice_number = `GST-${Date.now().toString().slice(-6)}`;
            const irn = `IRN-${Date.now().toString()}`;
            
            const result = await db.prepare(`
                INSERT INTO gst_invoices (
                    user_id, invoice_number, client_name, amount, gst_amount, 
                    invoice_type, place_of_supply, taxable_value, gst_percentage, 
                    cgst_amount, sgst_amount, igst_amount, total_tax, 
                    reverse_charge, irn_number, qr_status, is_eway_bill, is_reconciliation, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'false', 'false', ?)
            `).run(
                req.user.id, invoice_number, 'Client Name', total, tax,
                invoice_type || 'B2B', place_of_supply || '27-Maharashtra', taxable, pct,
                cgst, sgst, igst, tax,
                reverse_charge || 'No', irn, 'Signed', new Date().toISOString()
            );

            return sendSuccess(res, { id: result.lastInsertRowid, invoice_number }, 'Tax Invoice successfully generated');
        } catch (e) {
            console.error('[GST Controller] generateInvoice error:', e);
            return sendError(res, 'Internal server error', 500);
        }
    },

    getEways: async (req, res) => {
        try {
            const eways = await db.prepare("SELECT * FROM gst_invoices WHERE user_id = ? AND is_eway_bill = 'true'").all(req.user.id);
            return sendSuccess(res, eways, 'E-Way bills fetched');
        } catch (e) {
            console.error('[GST Controller] getEways error:', e);
            return sendError(res, 'Internal server error', 500);
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
            
            const eway_bill_number = `EWB-${Date.now().toString().slice(-8)}`;
            
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
                req.user.id, invoice_number, transporter_name, vehicle_number || null,
                parseInt(transport_distance) || 0, dispatch_location, delivery_location,
                eway_bill_number, transport_mode || 'Road', transporter_gstin || null,
                goods_product_name || null, goods_hsn_code || null, 
                goods_quantity ? parseFloat(goods_quantity) : null, goods_unit || null,
                goods_taxable_value ? parseFloat(goods_taxable_value) : null,
                goods_gst_rate ? parseFloat(goods_gst_rate) : null,
                goods_total_value ? parseFloat(goods_total_value) : null,
                items ? (typeof items === 'string' ? items : JSON.stringify(items)) : null,
                invoice_date || new Date().toISOString(), invoice_number
            );

            // If the sales invoice exists in gst_invoices, update its eway_bill_number
            if (invoice_number) {
                await db.prepare("UPDATE gst_invoices SET eway_bill_number = ? WHERE user_id = ? AND invoice_number = ?").run(eway_bill_number, req.user.id, invoice_number);
            }

            return sendSuccess(res, { id: result.lastInsertRowid, eway_bill_number }, 'e-Way Bill generated successfully');
        } catch (e) {
            console.error('[GST Controller] createEway error:', e);
            return sendError(res, 'Internal server error', 500);
        }
    },

    getReconciliations: async (req, res) => {
        try {
            const reconciliations = await db.prepare("SELECT * FROM gst_invoices WHERE user_id = ? AND is_reconciliation = 'true'").all(req.user.id);
            return sendSuccess(res, reconciliations, 'Reconciliations fetched');
        } catch (e) {
            console.error('[GST Controller] getReconciliations error:', e);
            return sendError(res, 'Internal server error', 500);
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
            return sendError(res, 'Internal server error', 500);
        }
    },

    deleteInvoice: async (req, res) => {
        try {
            const { id } = req.params;
            await db.prepare('DELETE FROM gst_invoices WHERE id = ? AND user_id = ?').run(id, req.user.id);
            return sendSuccess(res, { id }, 'Record deleted successfully');
        } catch (e) {
            console.error('[GST Controller] deleteInvoice error:', e);
            return sendError(res, 'Internal server error', 500);
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
            return sendError(res, 'Internal server error', 500);
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
            return sendError(res, 'Internal server error', 500);
        }
    }
};

module.exports = gstController;
