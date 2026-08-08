const db = require('../db/connection');
const gstHelper = require('../utils/gstHelper');

async function resyncAllGstr2() {
    console.log("=== RESYNCING ALL PURCHASES TO GSTR-2B ===");

    const purchases = await db.prepare("SELECT id, user_id, purchase_number FROM business_purchases").all();
    console.log(`Found ${purchases.length} purchases to resync.`);

    for (const pur of purchases) {
        await gstHelper.syncPurchaseToGstr2b(pur.id, pur.user_id);
    }

    console.log("✅ All purchases resynced to GSTR-2B successfully.");

    const updated = await db.prepare(`
        SELECT id, invoice_number, vendor_name, amount, taxable_value, total_tax, cgst_amount, sgst_amount, igst_amount, eligible_itc, status
        FROM gst_invoices
        WHERE is_reconciliation = 'true'
        ORDER BY id DESC LIMIT 10
    `).all();

    console.table(updated);
}

resyncAllGstr2().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
