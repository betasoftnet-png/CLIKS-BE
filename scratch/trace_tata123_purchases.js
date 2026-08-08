const db = require('../db/connection');

async function traceTata123() {
    console.log("==================================================================");
    console.log("   TRACING TATA123 PURCHASES & USER ACCOUNTS");
    console.log("==================================================================");

    // 1. All users in DB with username 'tata123' or email 'tata123@bnxmail.com'
    const users = await db.prepare(`
        SELECT id, username, email, role, receive_data, receiveData, created_at 
        FROM users 
        WHERE LOWER(username) = 'tata123' OR LOWER(email) = 'tata123@bnxmail.com'
    `).all();
    console.log("1. Users matching tata123:", users);

    // 2. All users in DB with username 'sanjay123' or email 'sanjay123@bnxmail.com'
    const merchants = await db.prepare(`
        SELECT id, username, business_name, email, role 
        FROM users 
        WHERE LOWER(username) = 'sanjay123' OR LOWER(email) = 'sanjay123@bnxmail.com'
    `).all();
    console.log("2. Merchants matching sanjay123:", merchants);

    // 3. All connections in customer_connections
    const conns = await db.prepare(`
        SELECT * FROM customer_connections WHERE LOWER(customer_email) = 'tata123@bnxmail.com'
    `).all();
    console.log("3. Customer Connections for tata123@bnxmail.com:", conns);

    // 4. Invoices in business_invoices for INV-798706, INV-449870, INV-970790
    const invs = await db.prepare(`
        SELECT id, user_id, invoice_number, client_name, client_email, amount, total_amount, status, created_at 
        FROM business_invoices 
        WHERE invoice_number IN ('INV-798706', 'INV-449870', 'INV-970790') OR client_name = 'santhosh' OR LOWER(client_email) = 'tata123@bnxmail.com'
        ORDER BY id DESC
    `).all();
    console.log("4. Invoices in business_invoices:", invs);

    // 5. Records in customer_purchase_history
    const cph = await db.prepare(`
        SELECT id, invoice_number, merchant_business_id, merchant_name, customer_user_id, customer_name, customer_email, total_amount, sendToCustomerHistory, sendPurchaseHistoryToCustomer, created_at 
        FROM customer_purchase_history 
        WHERE LOWER(customer_email) = 'tata123@bnxmail.com' OR customer_name = 'santhosh'
        ORDER BY id DESC
    `).all();
    console.log("5. Records in customer_purchase_history:", cph);

    // 6. Records in purchase_history
    const ph = await db.prepare(`
        SELECT id, invoice_number, merchant_business_id, merchant_name, customer_user_id, customer_name, customer_email, total_amount, created_at 
        FROM purchase_history 
        WHERE LOWER(customer_email) = 'tata123@bnxmail.com' OR customer_name = 'santhosh'
        ORDER BY id DESC
    `).all();
    console.log("6. Records in purchase_history:", ph);
}

traceTata123().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
