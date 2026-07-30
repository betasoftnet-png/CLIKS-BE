const db = require('../db/connection');
const gstHelper = require('../utils/gstHelper');

async function main() {
    try {
        const userId = 1;
        const now = new Date().toISOString();
        const billNum = `BILL-TEST-${Date.now().toString().slice(-4)}`;
        const dateStr = now.split('T')[0];
        const due_date = new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0];
        const parsedAmount = 11800;

        const totalTax = parsedAmount * 18 / 118;
        const subtotalAmt = parsedAmount - totalTax;

        console.log("1. Inserting dummy credit purchase bill...");
        const purResult = await db.prepare(`
            INSERT INTO business_purchases (
                user_id, purchase_number, purchase_date, due_date, doc_type, status, supplier_name, supplier_gstin,
                payment_status, payment_mode, paid_amount, grand_total, subtotal, total_tax, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'BILL', 'Pending Goods', ?, ?, 'pending', 'Credit', 0, ?, ?, ?, ?, ?)
        `).run(userId, billNum, dateStr, due_date, 'Vasanth & Co', null, parsedAmount, subtotalAmt, totalTax, now, now);

        const newPurchaseId = purResult.lastInsertRowid;
        console.log("Created Purchase ID:", newPurchaseId);

        console.log("2. Inserting default item...");
        await db.prepare(`
            INSERT INTO business_purchase_items (
                purchase_id, product_name, quantity, received_quantity,
                purchase_price, discount, gst_percentage, tax_amount, total
            ) VALUES (?, 'Inventory Purchases', 1, 0, ?, 0, 18, ?, ?)
        `).run(newPurchaseId, subtotalAmt, totalTax, parsedAmount);

        console.log("3. Syncing to GSTR-2B initially (Should be Pending)...");
        await gstHelper.syncPurchaseToGstr2b(newPurchaseId, userId);

        let gstr2bRow = await db.prepare("SELECT * FROM gst_invoices WHERE purchase_invoice_id = ?").get(newPurchaseId);
        console.log("Initial GSTR-2B row:", gstr2bRow);

        console.log("4. Simulating Receive Goods...");
        // Mark bill completed
        await db.prepare(`
            UPDATE business_purchases SET status = 'Completed', updated_at = ? WHERE id = ?
        `).run(now, newPurchaseId);

        console.log("5. Syncing to GSTR-2B after Receive Goods (Should be Verified)...");
        await gstHelper.syncPurchaseToGstr2b(newPurchaseId, userId);

        gstr2bRow = await db.prepare("SELECT * FROM gst_invoices WHERE purchase_invoice_id = ?").get(newPurchaseId);
        console.log("After Receive Goods GSTR-2B row:", gstr2bRow);

    } catch (e) {
        console.error("Test failed:", e);
    } finally {
        process.exit(0);
    }
}

main();
