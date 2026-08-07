const db = require('../db/connection');

async function inspectRecent() {
    console.log('=== INSPECTING RECENT USERS AND INVOICES ===');

    const users = await db.prepare("SELECT id, username, email, receive_data, receiveData, settings FROM users ORDER BY id DESC LIMIT 10").all();
    console.log('\n--- RECENT USERS ---');
    console.log(users);

    const invoices = await db.prepare("SELECT id, invoice_number, user_id, client_name, client_email, sendToCustomerHistory, sendPurchaseHistoryToCustomer, created_at FROM business_invoices ORDER BY id DESC LIMIT 10").all();
    console.log('\n--- RECENT INVOICES ---');
    console.log(invoices);
}

inspectRecent().catch(err => console.error(err));
