const db = require('../db/connection');

async function inspectAllUsersAndCustomers() {
    console.log("=== USERS IN DB ===");
    const users = await db.prepare("SELECT id, username, email, role, created_at FROM users").all();
    console.log(users);

    console.log("\n=== BUSINESS CUSTOMERS IN DB ===");
    const bCusts = await db.prepare("SELECT id, user_id, name, email, customer_code FROM business_customers").all();
    console.log(bCusts);

    console.log("\n=== CUSTOMER CONNECTIONS IN DB ===");
    const conns = await db.prepare("SELECT * FROM customer_connections").all();
    console.log(conns);
}

inspectAllUsersAndCustomers().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
