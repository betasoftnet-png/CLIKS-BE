const db = require('../db/connection');

async function inspect() {
    console.log('=== INSPECTING DATABASE FOR dineshkumar90@bnxmail.com ===');
    const email = 'dineshkumar90@bnxmail.com';

    // 1. Check user
    const users = await db.prepare("SELECT * FROM users WHERE LOWER(email) = ?").all(email.toLowerCase());
    console.log('\n--- USERS MATCHING EMAIL ---');
    console.log(users);

    // 2. Check business_invoices
    const invoices = await db.prepare("SELECT id, invoice_number, user_id, client_name, client_email, sendToCustomerHistory, sendPurchaseHistoryToCustomer, created_at FROM business_invoices WHERE LOWER(client_email) = ? ORDER BY id DESC").all(email.toLowerCase());
    console.log('\n--- BUSINESS INVOICES FOR EMAIL ---');
    console.log(invoices);

    // 3. Check customer_purchase_history
    const purchaseHist = await db.prepare("SELECT * FROM customer_purchase_history WHERE LOWER(customer_email) = ? ORDER BY id DESC").all(email.toLowerCase());
    console.log('\n--- CUSTOMER PURCHASE HISTORY ---');
    console.log(purchaseHist);

    // 4. Check purchase_history
    const purchaseHist2 = await db.prepare("SELECT * FROM purchase_history WHERE LOWER(customer_email) = ? ORDER BY id DESC").all(email.toLowerCase());
    console.log('\n--- PURCHASE HISTORY TABLE ---');
    console.log(purchaseHist2);
}

inspect().catch(err => console.error(err));
