const db = require('../db/connection');

async function diagnoseInvoice() {
    console.log("=== DIAGNOSING INV-449870 ===");

    // 1. Check business_invoices table for INV-449870
    const inv = await db.prepare("SELECT * FROM business_invoices WHERE invoice_number LIKE '%449870%' OR invoice_number = 'INV-449870'").get();
    console.log("1. business_invoices Record:", inv);

    if (!inv) {
        // Also check if any recent invoices exist
        const recentInvoices = await db.prepare("SELECT id, invoice_number, client_name, client_email, total_amount, user_id, sendPurchaseHistoryToCustomer, sendToCustomerHistory, created_at FROM business_invoices ORDER BY id DESC LIMIT 5").all();
        console.log("Recent Invoices in DB:", recentInvoices);
    }

    // 2. Check customer_connections table for tata123@bnxmail.com
    const conn = await db.prepare("SELECT * FROM customer_connections WHERE LOWER(customer_email) = 'tata123@bnxmail.com'").all();
    console.log("2. customer_connections Records for tata123@bnxmail.com:", conn);

    // 3. Check customer_purchase_history table for 449870 or tata123@bnxmail.com
    const purchases = await db.prepare("SELECT * FROM customer_purchase_history WHERE LOWER(customer_email) = 'tata123@bnxmail.com' OR invoice_number LIKE '%449870%'").all();
    console.log("3. customer_purchase_history Records:", purchases);

    // 4. Check user record for tata123@bnxmail.com or tata123
    const user = await db.prepare("SELECT id, username, email, role, receive_data, receiveData, settings FROM users WHERE LOWER(email) = 'tata123@bnxmail.com' OR username = 'tata123'").all();
    console.log("4. User Records for tata123:", user);
}

diagnoseInvoice().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
