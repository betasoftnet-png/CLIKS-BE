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

            // Evaluate whether it belongs in GSTR-2B
            if (!pur.supplier_gstin || pur.supplier_gstin.trim() === '') {
                // If it doesn't have a GSTIN, remove it from GSTR-2B if it exists there
                await db.prepare("DELETE FROM gst_invoices WHERE purchase_invoice_id = ?").run(purchaseId);
                return;
            }

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
            if (!isEligible) {
                status = 'Ineligible';
            } else if (existing) {
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
                    pur.supplier_gstin,
                    pur.supplier_name,
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
                        user_id, purchase_invoice_id, vendor_gstin, vendor_name, invoice_number, invoice_date,
                        amount, taxable_value, total_tax, cgst_amount, sgst_amount, igst_amount,
                        eligible_itc, invoice_match_status, status, is_reconciliation, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'true', ?, ?)
                `).run(
                    userId || pur.user_id,
                    pur.id,
                    pur.supplier_gstin,
                    pur.supplier_name,
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
    }
};

module.exports = gstHelper;
