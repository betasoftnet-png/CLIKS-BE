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

            // Determine local user state code from settings
            let userStateCode = '33'; // Default to Tamil Nadu
            const user = await db.prepare('SELECT settings FROM users WHERE id = ?').get(userId || pur.user_id);
            if (user && user.settings) {
                try {
                    const parsed = JSON.parse(user.settings);
                    if (parsed.state_code) {
                        userStateCode = String(parsed.state_code).substring(0, 2);
                    }
                } catch (e) {
                    // Ignore
                }
            }

            // Determine vendor state code
            let vendorStateCode = '';
            if (supplierGstin && supplierGstin !== 'URD-UNREGISTERED') {
                const matchedState = supplierGstin.trim().substring(0, 2);
                if (/^\d{2}$/.test(matchedState)) {
                    vendorStateCode = matchedState;
                }
            }

            const placeOfSupply = pur.place_of_supply || '';
            if (!vendorStateCode && placeOfSupply) {
                const matchedPos = placeOfSupply.trim().substring(0, 2);
                if (/^\d{2}$/.test(matchedPos)) {
                    vendorStateCode = matchedPos;
                }
            }

            // Determine intra-state (local CGST+SGST) vs inter-state (IGST)
            let isLocal = true;
            if (vendorStateCode && vendorStateCode !== userStateCode) {
                isLocal = false; // Inter-state -> IGST
            }

            // Extract or calculate tax amounts
            let tax = parseFloat(pur.total_tax) || 0;
            const grandTotal = parseFloat(pur.grand_total) || parseFloat(pur.amount) || 0;
            let subtotal = parseFloat(pur.subtotal) || 0;

            // If pur.total_tax is 0/missing but grandTotal > subtotal > 0:
            if (tax <= 0 && grandTotal > subtotal && subtotal > 0) {
                tax = grandTotal - subtotal;
            }

            // Scan items for tax amounts or tax rates
            const items = await db.prepare("SELECT * FROM business_purchase_items WHERE purchase_id = ?").all(pur.id);
            let isEligible = true;
            let eligibleItc = 0;
            let totalItemTax = 0;
            let eligibleTaxSum = 0;
            let hasEligible = false;

            if (items && items.length > 0) {
                for (const item of items) {
                    let itemTax = parseFloat(item.tax_amount) || 0;
                    const itemRate = parseFloat(item.tax_rate) || parseFloat(item.gst_percentage) || 0;
                    const itemTotal = parseFloat(item.total) || parseFloat(item.price) || 0;

                    if (itemTax <= 0 && itemRate > 0 && itemTotal > 0) {
                        itemTax = itemTotal * (itemRate / (100 + itemRate));
                    }

                    totalItemTax += itemTax;

                    if (isItcEligible(item.product_name)) {
                        eligibleTaxSum += itemTax;
                        hasEligible = true;
                    }
                }

                if (totalItemTax > 0 && tax <= 0) {
                    tax = totalItemTax;
                }
            }

            // If tax is STILL 0, but pur.gst_percentage > 0 and grandTotal > 0:
            const purGstPct = parseFloat(pur.gst_percentage) || parseFloat(pur.tax_rate) || 0;
            if (tax <= 0 && purGstPct > 0 && grandTotal > 0) {
                tax = grandTotal * (purGstPct / (100 + purGstPct));
            }

            // If tax is STILL 0 and grandTotal > 0:
            // Calculate 18% standard GST tax breakdown for non-exempt purchases
            if (tax <= 0 && grandTotal > 0 && (!pur.supplier_name || !String(pur.supplier_name).toLowerCase().includes('exempt'))) {
                const stdPct = 18;
                tax = Math.round((grandTotal * (stdPct / (100 + stdPct))) * 100) / 100;
            }

            tax = Math.round(tax * 100) / 100;
            if (subtotal <= 0) {
                subtotal = Math.max(0, Math.round((grandTotal - tax) * 100) / 100);
            }

            const cgst = isLocal ? Math.round((tax / 2) * 100) / 100 : 0;
            const sgst = isLocal ? Math.round((tax / 2) * 100) / 100 : 0;
            const igst = isLocal ? 0 : tax;

            if (items && items.length > 0) {
                if (!hasEligible) {
                    isEligible = false;
                    eligibleItc = 0;
                } else {
                    eligibleItc = eligibleTaxSum > 0 ? Math.round(eligibleTaxSum * 100) / 100 : tax;
                }
            } else {
                eligibleItc = tax;
            }

            // Check if record already exists in GSTR-2B (gst_invoices)
            const existing = await db.prepare("SELECT id, invoice_match_status, status FROM gst_invoices WHERE purchase_invoice_id = ?").get(pur.id);

            let status = 'Pending';
            if (pur.status === 'Completed' || pur.status === 'Verified') {
                status = 'Verified';
            }
            if (!isEligible) {
                status = 'Ineligible';
            } else if (existing && pur.status !== 'Completed' && pur.status !== 'Verified') {
                status = existing.invoice_match_status || existing.status || 'Pending';
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
                    grandTotal,
                    subtotal,
                    tax,
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
                    grandTotal,
                    subtotal,
                    tax,
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

            const targetUserId = userId || inv.user_id;

            // Determine Invoice Type (B2B, B2C, Export)
            let invoiceType = 'B2C';
            const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/i;
            const rawGstin = inv.client_gstin ? String(inv.client_gstin).trim() : '';

            if (inv.invoice_type === 'Export' || String(inv.export_under_lut) === 'true') {
                invoiceType = 'Export';
            } else if (rawGstin && rawGstin !== 'URD-CONSUMER' && rawGstin !== 'URD-UNREGISTERED' && (gstinRegex.test(rawGstin) || rawGstin.length >= 10)) {
                invoiceType = 'B2B';
            } else {
                invoiceType = 'B2C';
            }

            const clientGstin = (invoiceType === 'B2B') ? rawGstin : 'URD-CONSUMER';

            // Determine local state code from user settings
            let senderStateCode = '33';
            let senderName = '';
            let senderGstin = '';
            let senderState = 'Tamil Nadu';

            const user = await db.prepare('SELECT settings FROM users WHERE id = ?').get(targetUserId);
            if (user && user.settings) {
                try {
                    const parsed = JSON.parse(user.settings);
                    senderName = parsed.company_name || parsed.legal_name || parsed.business_name || '';
                    senderGstin = parsed.gstin || '';
                    senderState = parsed.state || parsed.registered_state || 'Tamil Nadu';
                    if (parsed.state_code) {
                        senderStateCode = String(parsed.state_code).substring(0, 2);
                    } else if (senderGstin && senderGstin.length >= 2) {
                        senderStateCode = senderGstin.substring(0, 2);
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
            } else if (rawGstin && rawGstin.length >= 2) {
                receiverStateCode = rawGstin.substring(0, 2);
            }

            const isLocal = senderStateCode === receiverStateCode;

            // Parse items JSON to compute totals, tax amounts, HSN code, and rates
            let items = inv.items;
            if (typeof items === 'string') {
                try { items = JSON.parse(items); } catch (e) { items = []; }
            }
            if (!Array.isArray(items)) items = [];

            let primaryHsn = '';
            let primaryProdName = '';
            let primaryGstPct = 18;
            let calculatedTaxable = 0;
            let calculatedTax = 0;

            if (items.length > 0) {
                for (const item of items) {
                    const name = item.product_name || item.name || item.description || 'Item';
                    const hsn = item.hsn_code || item.sku || item.hsn_sac || item.sku_hsn || '';
                    const rate = parseFloat(item.price || item.rate || item.unit_price) || 0;
                    const qty = parseFloat(item.quantity) || 1;
                    const gstPct = parseFloat(item.tax_rate || item.gst_percentage || item.gst_rate) || 18;
                    const itemAmt = parseFloat(item.total || item.amount) || (qty * rate);

                    if (!primaryHsn && hsn) primaryHsn = hsn;
                    if (!primaryProdName && name) primaryProdName = name;
                    primaryGstPct = gstPct;

                    let itemTaxable = 0;
                    let itemTax = 0;
                    if (inv.tax_type === 'Inclusive') {
                        itemTaxable = itemAmt / (1 + gstPct / 100);
                        itemTax = itemAmt - itemTaxable;
                    } else {
                        itemTaxable = itemAmt;
                        itemTax = itemAmt * (gstPct / 100);
                    }
                    calculatedTaxable += itemTaxable;
                    calculatedTax += itemTax;
                }
            }

            const totalInvoice = parseFloat(inv.total_amount) || 0;
            let tax = parseFloat(inv.tax_amount) || 0;
            if (tax <= 0 && calculatedTax > 0) tax = calculatedTax;

            let taxableValue = parseFloat(inv.amount) || 0;
            if (taxableValue <= 0) {
                if (calculatedTaxable > 0) {
                    taxableValue = calculatedTaxable;
                } else if (totalInvoice > 0) {
                    taxableValue = tax > 0 ? (totalInvoice - tax) : totalInvoice;
                }
            }

            // Round to 2 decimal places
            tax = Math.round(tax * 100) / 100;
            taxableValue = Math.round(taxableValue * 100) / 100;

            const cgst = isLocal ? Math.round((tax / 2) * 100) / 100 : 0;
            const sgst = isLocal ? Math.round((tax / 2) * 100) / 100 : 0;
            const igst = isLocal ? 0 : tax;

            const now = new Date().toISOString();
            const invoiceStatus = inv.status === 'Cancelled' ? 'Cancelled' : 'READY';
            const itemsJson = typeof inv.items === 'string' ? inv.items : JSON.stringify(items);

            // Sync with existing record in gst_invoices using invoice_number as unique key for this user
            const existing = await db.prepare("SELECT id FROM gst_invoices WHERE invoice_number = ? AND user_id = ?").get(inv.invoice_number, targetUserId);

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
                        gst_percentage = ?,
                        goods_hsn_code = ?,
                        goods_product_name = ?,
                        items = ?,
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
                    totalInvoice,
                    tax,
                    invoiceType,
                    placeOfSupply,
                    taxableValue,
                    cgst,
                    sgst,
                    igst,
                    tax,
                    totalInvoice,
                    primaryGstPct,
                    primaryHsn,
                    primaryProdName,
                    itemsJson,
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
                        gst_percentage, goods_hsn_code, goods_product_name, items,
                        tax_type, is_eway_bill, is_reconciliation, status, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Exclusive', 'false', 'false', ?, ?, ?)
                `).run(
                    targetUserId,
                    inv.invoice_number,
                    inv.client_name,
                    inv.client_name,
                    clientGstin,
                    placeOfSupply,
                    senderName,
                    senderGstin,
                    senderState,
                    totalInvoice,
                    tax,
                    invoiceType,
                    placeOfSupply,
                    taxableValue,
                    cgst,
                    sgst,
                    igst,
                    tax,
                    totalInvoice,
                    primaryGstPct,
                    primaryHsn,
                    primaryProdName,
                    itemsJson,
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
