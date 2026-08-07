const db = require('../db/connection');

async function listAllInvoices() {
    const allInvs = await db.prepare("SELECT id, invoice_number, user_id, client_name, client_email, sendToCustomerHistory, sendPurchaseHistoryToCustomer, created_at FROM business_invoices ORDER BY id DESC").all();
    console.log('All Invoices in business_invoices:', allInvs);
}

listAllInvoices().catch(err => console.error(err));
