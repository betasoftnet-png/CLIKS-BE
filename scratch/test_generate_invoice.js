const db = require('../db/connection');

async function main() {
    try {
        const now = new Date().toISOString();
        const invoice_number = `GST-TEST-${Date.now().toString().slice(-4)}`;
        const irn = `IRN-TEST-${Date.now().toString()}`;

        console.log("Inserting e-Invoice into gst_invoices...");
        const result = await db.prepare(`
            INSERT INTO gst_invoices (
                user_id, invoice_number, client_name, customer_name, customer_gstin, customer_state,
                sender_name, sender_gstin, sender_state, amount, gst_amount, 
                invoice_type, place_of_supply, taxable_value, gst_percentage, 
                cgst, sgst, igst, cgst_amount, sgst_amount, igst_amount, total_tax, 
                reverse_charge, total_invoice, tax_type, irn_number, qr_status, is_eway_bill, is_reconciliation, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Exclusive', ?, ?, 'false', 'false', ?, ?)
        `).run(
            1, invoice_number, 'Test Customer', 'Test Customer', '33ABCDE1234F1Z5', '33-Tamil Nadu',
            'My Company', '33AAAAA1111A1Z5', 'Tamil Nadu', 11800, 1800,
            'B2B', '33-Tamil Nadu', 10000, 18,
            900, 900, 0, 900, 900, 0, 1800,
            'No', 11800, irn, 'Signed', now, now
        );
        console.log("Insert result:", result);

        console.log("Querying getInvoices...");
        const isPg = process.env.DB_TYPE === 'postgres';
        const notEway = isPg ? `(is_eway_bill IS NOT TRUE AND is_eway_bill::text NOT IN ('true','1'))` : `(is_eway_bill = 'false' OR is_eway_bill IS NULL)`;
        const notRecon = isPg ? `(is_reconciliation IS NOT TRUE AND is_reconciliation::text NOT IN ('true','1'))` : `(is_reconciliation = 'false' OR is_reconciliation IS NULL)`;
        
        const invoices = await db.prepare(`SELECT * FROM gst_invoices WHERE user_id = ? AND ${notEway} AND ${notRecon}`).all(1);
        console.log("Fetched Invoices:", invoices);
    } catch (e) {
        console.error("Error:", e);
    } finally {
        process.exit(0);
    }
}

main();
