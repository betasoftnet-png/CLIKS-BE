const db = require('../db/connection');

function isItcEligible(itemName) {
    if (!itemName) return true;
    const name = String(itemName).toLowerCase();
    const ineligibleKeywords = [
        'personal', 'gift', 'employee gift', 'entertainment', 'food', 'beverage', 'car', 'vehicle',
        'dining', 'hotel', 'lunch', 'dinner', 'snack', 'cafe', 'restaurant', 'gift card'
    ];
    for (const kw of ineligibleKeywords) {
        if (name.includes(kw)) return false;
    }
    return true;
}

const gstHelper = {
    syncPurchaseToGstr2b: async (purchaseId, userId) => {
        try {
            // 1. Fetch purchase record
            const pur = await db.prepare("SELECT * FROM business_purchases WHERE id = ?").get(purchaseId);
            if (!pur) {
                // If purchase was deleted, delete corresponding GSTR-2B entry
                await db.prepare("DELETE FROM gst_invoices WHERE purchase_invoice_id = ?").run(purchaseId);
                return;
            }

            const supplierGstin = pur.supplier_gstin && pur.supplier_gstin.trim() !== '' ? pur.supplier_gstin : 'URD-UNREGISTERED';

            // Determine local state code from user settings
            let senderStateCode = '33'; // Default to Tamil Nadu
            const user = await db.prepare('SELECT settings FROM users WHERE id = ?').get(userId || pur.user_id);
            if (user && user.settings) {
                try {
                    const parsed = JSON.parse(user.settings);
                    if (parsed.state_code) {
                        senderStateCode = parsed.state_code.substring(0, 2);
                    }
                } catch (e) {
                    // Ignore
                }
            }

            const placeOfSupply = pur.place_of_supply || '';
            const receiverStateCode = placeOfSupply.substring(0, 2);
            const isLocal = senderStateCode === receiverStateCode;

            const tax = parseFloat(pur.total_tax) || 0;
            const cgst = isLocal ? tax / 2 : 0;
            const sgst = isLocal ? tax / 2 : 0;
            const igst = isLocal ? 0 : tax;

            // Determine ITC eligibility
            // Scan all items in the purchase invoice
            const items = await db.prepare("SELECT * FROM business_purchase_items WHERE purchase_id = ?").all(pur.id);
            let isEligible = true;
            let eligibleItc = tax;

            if (items && items.length > 0) {
                let eligibleTaxSum = 0;
                let hasEligible = false;
                for (const item of items) {
                    const itemTax = parseFloat(item.tax_amount) || 0;
                    if (isItcEligible(item.product_name)) {
                        eligibleTaxSum += itemTax;
                        hasEligible = true;
                    }
                }
                if (!hasEligible) {
                    isEligible = false;
                    eligibleItc = 0;
                } else {
                    eligibleItc = eligibleTaxSum;
                }
            }

            // Check if record already exists in GSTR-2B (gst_invoices)
            const existing = await db.prepare("SELECT id, invoice_match_status, status FROM gst_invoices WHERE purchase_invoice_id = ?").get(pur.id);

            let status = 'Pending';
            if (pur.status === 'Completed') {
                status = 'Verified';
            }
            if (!isEligible) {
                status = 'Ineligible';
            } else if (existing && pur.status !== 'Completed') {
                status = existing.invoice_match_status || existing.status || 'Pending';
                // If it was marked ineligible previously but is now eligible, reset to Pending
                if (status === 'Ineligible') {
                    status = 'Pending';
                }
            }

            if (existing) {
                await db.prepare(`
                    UPDATE gst_invoices SET
                        vendor_gstin = ?,
                        vendor_name = ?,
                        client_name = ?,
                        invoice_number = ?,
                        invoice_date = ?,
                        amount = ?,
                        taxable_value = ?,
                        total_tax = ?,
                        cgst_amount = ?,
                        sgst_amount = ?,
                        igst_amount = ?,
                        eligible_itc = ?,
                        invoice_match_status = ?,
                        status = ?,
                        updated_at = ?
                    WHERE id = ?
                `).run(
                    supplierGstin,
                    pur.supplier_name,
                    pur.supplier_name || 'Unknown Vendor',
                    pur.purchase_number,
                    pur.purchase_date,
                    pur.grand_total,
                    pur.subtotal,
                    pur.total_tax,
                    cgst,
                    sgst,
                    igst,
                    eligibleItc,
                    status,
                    status,
                    new Date().toISOString(),
                    existing.id
                );
            } else {
                await db.prepare(`
                    INSERT INTO gst_invoices (
                        user_id, purchase_invoice_id, vendor_gstin, vendor_name, client_name,
                        invoice_number, invoice_date,
                        amount, taxable_value, total_tax, cgst_amount, sgst_amount, igst_amount,
                        eligible_itc, invoice_match_status, status, is_reconciliation, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'true', ?, ?)
                `).run(
                    userId || pur.user_id,
                    pur.id,
                    supplierGstin,
                    pur.supplier_name,
                    pur.supplier_name || 'Unknown Vendor',
                    pur.purchase_number,
                    pur.purchase_date,
                    pur.grand_total,
                    pur.subtotal,
                    pur.total_tax,
                    cgst,
                    sgst,
                    igst,
                    eligibleItc,
                    status,
                    status,
                    new Date().toISOString(),
                    new Date().toISOString()
                );
            }
        } catch (err) {
            console.error('[GST Helper] syncPurchaseToGstr2b error:', err);
        }
    },

    syncInvoiceToGstr1: async (invoiceId, userId, deletedInvoiceNumber = null) => {
        try {
            if (deletedInvoiceNumber) {
                await db.prepare("DELETE FROM gst_invoices WHERE invoice_number = ? AND user_id = ? AND (is_reconciliation IS NULL OR is_reconciliation NOT IN ('true', '1', 1))").run(deletedInvoiceNumber, userId);
                return;
            }

            // 1. Fetch sales invoice record
            const inv = await db.prepare("SELECT * FROM business_invoices WHERE id = ?").get(invoiceId);
            if (!inv) return;

            // Determine Invoice Type (B2B, B2C, Export)
            let invoiceType = 'B2C';
            if (inv.invoice_type === 'Export') {
                invoiceType = 'Export';
            } else if (inv.client_gstin && inv.client_gstin.trim() !== '' && inv.client_gstin !== 'URD-CONSUMER' && inv.client_gstin !== 'URD-UNREGISTERED') {
                invoiceType = 'B2B';
            }

            const clientGstin = (invoiceType === 'B2B') ? inv.client_gstin : 'URD-CONSUMER';

            // Determine local state code from user settings
            let senderStateCode = '33';
            let senderName = '';
            let senderGstin = '';
            let senderState = 'Tamil Nadu';

            const user = await db.prepare('SELECT settings FROM users WHERE id = ?').get(userId || inv.user_id);
            if (user && user.settings) {
                try {
                    const parsed = JSON.parse(user.settings);
                    senderName = parsed.company_name || parsed.legal_name || '';
                    senderGstin = parsed.gstin || '';
                    senderState = parsed.state || parsed.registered_state || 'Tamil Nadu';
                    if (parsed.state_code) {
                        senderStateCode = parsed.state_code.substring(0, 2);
                    }
                } catch (e) {}
            }

            const placeOfSupply = inv.billing_address || inv.shipping_address || senderState;
            let receiverStateCode = senderStateCode;
            if (placeOfSupply.includes('-')) {
                const parts = placeOfSupply.split('-');
                if (parts[0].trim().length === 2) {
                    receiverStateCode = parts[0].trim();
                }
            } else if (inv.client_gstin && inv.client_gstin.length >= 2) {
                receiverStateCode = inv.client_gstin.substring(0, 2);
            }

            const isLocal = senderStateCode === receiverStateCode;
            const tax = parseFloat(inv.tax_amount || 0);
            const cgst = isLocal ? tax / 2 : 0;
            const sgst = isLocal ? tax / 2 : 0;
            const igst = isLocal ? 0 : tax;

            // Sync with existing record in gst_invoices using invoice_number as unique key
            const existing = await db.prepare("SELECT id FROM gst_invoices WHERE invoice_number = ? AND user_id = ?").get(inv.invoice_number, inv.user_id);

            const now = new Date().toISOString();
            const invoiceStatus = inv.status === 'Cancelled' ? 'Cancelled' : 'READY';

            if (existing) {
                await db.prepare(`
                    UPDATE gst_invoices SET
                        client_name = ?,
                        customer_name = ?,
                        customer_gstin = ?,
                        customer_state = ?,
                        sender_name = ?,
                        sender_gstin = ?,
                        sender_state = ?,
                        amount = ?,
                        gst_amount = ?,
                        invoice_type = ?,
                        place_of_supply = ?,
                        taxable_value = ?,
                        cgst_amount = ?,
                        sgst_amount = ?,
                        igst_amount = ?,
                        total_tax = ?,
                        total_invoice = ?,
                        status = ?,
                        updated_at = ?
                    WHERE id = ?
                `).run(
                    inv.client_name,
                    inv.client_name,
                    clientGstin,
                    placeOfSupply,
                    senderName,
                    senderGstin,
                    senderState,
                    inv.total_amount,
                    inv.tax_amount,
                    invoiceType,
                    placeOfSupply,
                    inv.amount,
                    cgst,
                    sgst,
                    igst,
                    tax,
                    inv.total_amount,
                    invoiceStatus,
                    now,
                    existing.id
                );
            } else {
                await db.prepare(`
                    INSERT INTO gst_invoices (
                        user_id, invoice_number, client_name, customer_name, customer_gstin, customer_state,
                        sender_name, sender_gstin, sender_state, amount, gst_amount,
                        invoice_type, place_of_supply, taxable_value,
                        cgst_amount, sgst_amount, igst_amount, total_tax, total_invoice,
                        tax_type, is_eway_bill, is_reconciliation, status, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Exclusive', 'false', 'false', ?, ?, ?)
                `).run(
                    userId || inv.user_id,
                    inv.invoice_number,
                    inv.client_name,
                    inv.client_name,
                    clientGstin,
                    placeOfSupply,
                    senderName,
                    senderGstin,
                    senderState,
                    inv.total_amount,
                    inv.tax_amount,
                    invoiceType,
                    placeOfSupply,
                    inv.amount,
                    cgst,
                    sgst,
                    igst,
                    tax,
                    inv.total_amount,
                    invoiceStatus,
                    inv.created_at || now,
                    now
                );
            }
        } catch (err) {
            console.error('[GST Helper] syncInvoiceToGstr1 error:', err);
        }
    }
};

module.exports = gstHelper;
