const db = require('../db/connection');

async function inspectInv() {
    console.log('=== INSPECTING INVOICE INV-073131 ===');

    const inv = await db.prepare("SELECT * FROM business_invoices WHERE invoice_number LIKE '%073131%' OR invoice_number = 'INV-073131'").all();
    console.log('\n--- BUSINESS INVOICES ---');
    console.log(inv);

    const custHist = await db.prepare("SELECT * FROM customer_purchase_history WHERE invoice_number LIKE '%073131%' OR invoice_number = 'INV-073131'").all();
    console.log('\n--- CUSTOMER PURCHASE HISTORY ---');
    console.log(custHist);

    const email = 'dineshkumar90@bnxmail.com';
    const users = await db.prepare("SELECT * FROM users WHERE LOWER(email) = ?").all(email);
    console.log('\n--- USERS MATCHING dineshkumar90@bnxmail.com ---');
    console.log(users);
}

inspectInv().catch(err => console.error(err));
