const db = require('../db/connection');

async function inspectPurchases() {
    console.log("=== INSPECTING business_purchases vs gst_invoices ===");

    const purchases = await db.prepare(`
        SELECT * 
        FROM business_purchases 
        ORDER BY id DESC LIMIT 15
    `).all();

    console.log("\n--- business_purchases ---");
    console.table(purchases);

    for (const pur of purchases) {
        const items = await db.prepare("SELECT * FROM business_purchase_items WHERE purchase_id = ?").all(pur.id);
        console.log(`Purchase ID ${pur.id} (${pur.purchase_number}) Items Count: ${items.length}`);
        if (items.length > 0) {
            console.table(items.map(i => ({ id: i.id, name: i.product_name, qty: i.quantity, price: i.price, tax_rate: i.tax_rate, tax_amount: i.tax_amount, total: i.total })));
        }
    }

    const gstInvoices = await db.prepare(`
        SELECT id, user_id, invoice_number, vendor_name, vendor_gstin, amount, taxable_value, total_tax, cgst_amount, sgst_amount, igst_amount, eligible_itc, status, invoice_match_status, is_reconciliation 
        FROM gst_invoices 
        WHERE is_reconciliation = 'true' OR vendor_name IS NOT NULL
        ORDER BY id DESC LIMIT 15
    `).all();

    console.log("\n--- gst_invoices (GSTR-2B) ---");
    console.table(gstInvoices);
}

inspectPurchases().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
