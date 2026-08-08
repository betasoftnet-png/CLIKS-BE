const db = require('../db/connection');

async function traceAuthAndConns() {
    console.log("=== ALL BUSINESS CUSTOMERS FOR SANTHOSH & TATA123 ===");
    const custs = await db.prepare(`
        SELECT * FROM business_customers 
        WHERE LOWER(email) = 'tata123@bnxmail.com' OR name = 'santhosh'
    `).all();
    console.log(custs);

    console.log("\n=== ALL CUSTOMER CONNECTIONS FOR TATA123 ===");
    const conns = await db.prepare(`
        SELECT * FROM customer_connections 
        WHERE LOWER(customer_email) = 'tata123@bnxmail.com'
    `).all();
    console.log(conns);

    console.log("\n=== ALL INVOICES FOR SANTHOSH / TATA123 ===");
    const invs = await db.prepare(`
        SELECT id, user_id, invoice_number, client_name, client_email, total_amount, created_at 
        FROM business_invoices 
        WHERE LOWER(client_email) = 'tata123@bnxmail.com' OR client_name = 'santhosh'
        ORDER BY id DESC
    `).all();
    console.log(invs);
}

traceAuthAndConns().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
