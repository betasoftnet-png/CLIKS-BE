const db = require('../db/connection');

function calculateWarrantyExpiry(startDateIso, warrantyPeriod) {
    const start = new Date(startDateIso);
    if (isNaN(start.getTime())) return null;

    const periodStr = String(warrantyPeriod || '1 Year').trim();
    const expiry = new Date(start);

    const match = periodStr.match(/(\d+)\s*(month|year|day|wk|week)s?/i);
    if (match) {
        const num = parseInt(match[1], 10);
        const unit = match[2].toLowerCase();

        if (unit.startsWith('month')) {
            expiry.setMonth(expiry.getMonth() + num);
        } else if (unit.startsWith('year')) {
            expiry.setFullYear(expiry.getFullYear() + num);
        } else if (unit.startsWith('day')) {
            expiry.setDate(expiry.getDate() + num);
        } else if (unit.startsWith('week') || unit.startsWith('wk')) {
            expiry.setDate(expiry.getDate() + (num * 7));
        }
    } else {
        // Default to 1 year if format unparsed
        expiry.setFullYear(expiry.getFullYear() + 1);
    }

    return expiry.toISOString().split('T')[0];
}

async function processWarrantyForCompletedSale({ userId, invoiceNumber, customerName, items, purchaseDate }) {
    if (!userId || !invoiceNumber || !items || !Array.isArray(items) || items.length === 0) {
        return;
    }

    const now = new Date().toISOString();
    const saleDate = purchaseDate || now;
    const custName = (customerName || 'Customer').trim();

    // Ensure columns exist in business_returns
    try { await db.prepare("ALTER TABLE business_returns ADD COLUMN claim_type TEXT").run(); } catch(e) {}
    try { await db.prepare("ALTER TABLE business_returns ADD COLUMN warranty_start_date TEXT").run(); } catch(e) {}
    try { await db.prepare("ALTER TABLE business_returns ADD COLUMN warranty_expiry_date TEXT").run(); } catch(e) {}

    for (const item of items) {
        const pId = item.id || item.product_id || null;
        const pName = (item.name || item.product_name || item.description || '').trim();

        if (!pId && !pName) continue;

        // Retrieve master product from business_products
        let masterProd = null;
        if (pId) {
            try {
                masterProd = await db.prepare('SELECT * FROM business_products WHERE user_id = ? AND id = ?').get(userId, pId);
            } catch (e) {}
        }
        if (!masterProd && pName) {
            try {
                masterProd = await db.prepare('SELECT * FROM business_products WHERE user_id = ? AND (LOWER(TRIM(name)) = LOWER(TRIM(?)) OR LOWER(TRIM(name)) LIKE LOWER(TRIM(?))) LIMIT 1')
                    .get(userId, pName, `%${pName}%`);
            } catch (e) {}
        }

        if (!masterProd) continue;

        const hasWarranty = masterProd.has_warranty === 'Yes' || masterProd.has_warranty === true || String(masterProd.has_warranty).toLowerCase() === 'yes';
        if (!hasWarranty) continue;

        const warrantyPeriod = masterProd.warranty_period || item.warranty_period || '1 Year';
        const expiryDateStr = calculateWarrantyExpiry(saleDate, warrantyPeriod);

        // Check if warranty record already exists for this invoice and product
        let existing = null;
        try {
            existing = await db.prepare(`
                SELECT r.id FROM business_returns r
                JOIN business_return_items ri ON r.id = ri.return_id
                WHERE r.user_id = ? AND r.return_type = 'warranty' AND r.invoice_id = ?
                  AND (ri.product_id = ? OR LOWER(ri.product_name) = ?)
                LIMIT 1
            `).get(userId, invoiceNumber, String(masterProd.id), pName.toLowerCase());
        } catch (e) {}

        if (!existing) {
            try {
                existing = await db.prepare(`
                    SELECT id FROM business_returns
                    WHERE user_id = ? AND return_type = 'warranty' AND invoice_id = ? AND customer_name = ?
                    LIMIT 1
                `).get(userId, invoiceNumber, custName);
            } catch (e) {}
        }

        if (existing) continue; // Avoid duplicate warranty records

        const cleanInvNum = invoiceNumber.replace(/^POS-?/i, '').replace(/^INV-?/i, '');
        const claimNumber = `CLM-${cleanInvNum || Date.now().toString().slice(-6)}`;
        const serialNum = item.serial_number || item.imei || masterProd.serial_number || 'N/A';
        const itemPrice = parseFloat(item.price || item.unit_price || masterProd.selling_price || 0) || 0;
        const itemQty = parseFloat(item.quantity || 1) || 1;

        try {
            const retRes = await db.prepare(`
                INSERT INTO business_returns (
                    user_id, return_number, return_type, return_date, status, invoice_id,
                    customer_name, refund_amount, refund_mode, refund_status, reason_code,
                    inspection_status, claim_type, warranty_start_date, warranty_expiry_date,
                    created_at, updated_at
                ) VALUES (?, ?, 'warranty', ?, 'Active', ?, ?, ?, 'N/A', 'valid', ?, 'Active Warranty', 'Warranty Tracking', ?, ?, ?, ?)
            `).run(
                userId, claimNumber, saleDate, invoiceNumber,
                custName, itemPrice * itemQty, `Warranty Period: ${warrantyPeriod} (Expires: ${expiryDateStr})`,
                saleDate.split('T')[0], expiryDateStr, now, now
            );

            const returnId = retRes.lastInsertRowid || retRes.id;

            await db.prepare(`
                INSERT INTO business_return_items (
                    return_id, product_id, product_name, serial_number, return_quantity, price, total
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
                returnId, String(masterProd.id), masterProd.name, serialNum, itemQty, itemPrice, itemPrice * itemQty
            );

            console.log(`[Warranty Sync] Successfully recorded warranty claim #${claimNumber} for ${custName} - ${masterProd.name} (Period: ${warrantyPeriod}, Expiry: ${expiryDateStr})`);
        } catch (errIns) {
            console.error('[Warranty Sync Error]', errIns);
        }
    }
}

async function syncPastInvoicesWarranties(userId) {
    if (!userId) return;
    try {
        const invoices = await db.prepare(`
            SELECT * FROM business_invoices 
            WHERE user_id = ? AND items IS NOT NULL
            ORDER BY id DESC LIMIT 50
        `).all(userId);

        for (const inv of invoices) {
            let itemsArr = [];
            try {
                itemsArr = typeof inv.items === 'string' ? JSON.parse(inv.items) : (inv.items || []);
            } catch (e) {}

            if (Array.isArray(itemsArr) && itemsArr.length > 0) {
                await processWarrantyForCompletedSale({
                    userId,
                    invoiceNumber: inv.invoice_number || `INV-${inv.id}`,
                    customerName: inv.client_name || inv.customer_name || 'Customer',
                    items: itemsArr,
                    purchaseDate: inv.created_at || new Date().toISOString()
                });
            }
        }
    } catch (err) {
        console.error('[Warranty Retroactive Sync Warning]', err.message || err);
    }
}

module.exports = {
    calculateWarrantyExpiry,
    processWarrantyForCompletedSale,
    syncPastInvoicesWarranties
};
