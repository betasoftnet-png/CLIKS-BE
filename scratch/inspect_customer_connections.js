const db = require('../db/connection');

async function inspectConnectionData() {
    console.log("==================================================================");
    console.log("   INSPECTING DB DATA FOR SANTHOSH2004@BNXMAIL.COM & GOPI");
    console.log("==================================================================");

    const email = 'santhosh2004@bnxmail.com';

    // 1. Check users
    const users = await db.prepare("SELECT id, username, email, role FROM users WHERE LOWER(email) LIKE '%santhosh%' OR LOWER(username) LIKE '%santhosh%' OR LOWER(username) LIKE '%gopi%'").all();
    console.log("\n1. Users matching santhosh/gopi:", users);

    // 2. Check ALL business_customers
    const busCusts = await db.prepare("SELECT id, user_id, name, email, phone_number, customer_code FROM business_customers ORDER BY id DESC").all();
    console.log("\n2. ALL business_customers records:", busCusts);

    // 3. Check ALL customer_connections
    const conns = await db.prepare("SELECT * FROM customer_connections ORDER BY id DESC").all();
    console.log("\n3. ALL customer_connections records:", conns);

    // 4. Check all recent business_invoices
    const invoices = await db.prepare("SELECT * FROM business_invoices ORDER BY id DESC LIMIT 10").all();
    console.log("\n4. Recent business_invoices records:", invoices.map(i => ({ id: i.id, user_id: i.user_id, invoice_number: i.invoice_number, client_name: i.client_name, client_email: i.client_email, total_amount: i.total_amount || i.grand_total, status: i.status })));

    // 5. Check customer_purchase_history
    const history = await db.prepare("SELECT id, invoice_number, merchant_business_id, merchant_name, customer_user_id, customer_email, net_amount, total_amount, created_at FROM customer_purchase_history ORDER BY id DESC LIMIT 10").all();
    console.log("\n5. customer_purchase_history records:", history);

    console.log("==================================================================");
}

inspectConnectionData().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
