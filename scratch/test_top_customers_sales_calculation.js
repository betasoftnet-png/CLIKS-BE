const db = require('../db/connection');
const crmController = require('../controllers/crmController');

async function verifyTopCustomerSalesCalculation() {
    console.log("==================================================================");
    console.log("   VERIFY TOP CUSTOMER SALES CONTRIBUTION CALCULATION");
    console.log("==================================================================");

    const now = new Date().toISOString();

    // 1. Get or create a merchant user
    let merchant = await db.prepare("SELECT * FROM users WHERE role = 'business' LIMIT 1").get();
    if (!merchant) {
        const mRes = await db.prepare(`
            INSERT INTO users (username, email, password_hash, role, business_name, created_at, updated_at)
            VALUES ('Top Customer Test Merchant', 'top_test_merchant@bnxmail.com', 'hash', 'business', 'Top Test Merchant', ?, ?)
        `).run(now, now);
        merchant = await db.prepare('SELECT * FROM users WHERE id = ?').get(mRes.lastInsertRowid);
    }
    console.log(`[TEST] Merchant User ID: ${merchant.id}`);

    // Clean up old test records
    await db.prepare("DELETE FROM business_invoices WHERE user_id = ? AND client_email IN ('alpha@bnxmail.com', 'beta@bnxmail.com')").run(merchant.id);
    await db.prepare("DELETE FROM business_customers WHERE user_id = ? AND email IN ('alpha@bnxmail.com', 'beta@bnxmail.com')").run(merchant.id);

    // 2. Create test customers
    const c1Res = await db.prepare(`
        INSERT INTO business_customers (user_id, name, email, customer_code, created_at, updated_at)
        VALUES (?, 'Alpha Buyer', 'alpha@bnxmail.com', 'CUST-A1', ?, ?)
    `).run(merchant.id, now, now);
    const c1 = await db.prepare('SELECT * FROM business_customers WHERE id = ?').get(c1Res.lastInsertRowid);

    const c2Res = await db.prepare(`
        INSERT INTO business_customers (user_id, name, email, customer_code, created_at, updated_at)
        VALUES (?, 'Beta Buyer', 'beta@bnxmail.com', 'CUST-B2', ?, ?)
    `).run(merchant.id, now, now);
    const c2 = await db.prepare('SELECT * FROM business_customers WHERE id = ?').get(c2Res.lastInsertRowid);

    // 3. Create test invoices in business_invoices
    // Invoices for Alpha Buyer (Paid ₹5000 + Unpaid ₹3000 = ₹8000)
    await db.prepare(`
        INSERT INTO business_invoices (user_id, invoice_number, client_name, client_email, total_amount, status, created_at, updated_at)
        VALUES (?, 'INV-ALPHA-1', ?, ?, 5000, 'Paid', ?, ?)
    `).run(merchant.id, c1.name, c1.email, now, now);

    await db.prepare(`
        INSERT INTO business_invoices (user_id, invoice_number, client_name, client_email, total_amount, status, created_at, updated_at)
        VALUES (?, 'INV-ALPHA-2', ?, ?, 3000, 'Unpaid', ?, ?)
    `).run(merchant.id, c1.name, c1.email, now, now);

    // Cancelled invoice for Alpha Buyer (₹10000 - SHOULD BE EXCLUDED)
    await db.prepare(`
        INSERT INTO business_invoices (user_id, invoice_number, client_name, client_email, total_amount, status, created_at, updated_at)
        VALUES (?, 'INV-ALPHA-CANCEL', ?, ?, 10000, 'Cancelled', ?, ?)
    `).run(merchant.id, c1.name, c1.email, now, now);

    // Invoices for Beta Buyer (Partially Paid ₹15000)
    await db.prepare(`
        INSERT INTO business_invoices (user_id, invoice_number, client_name, client_email, total_amount, status, created_at, updated_at)
        VALUES (?, 'INV-BETA-1', ?, ?, 15000, 'Partially Paid', ?, ?)
    `).run(merchant.id, c2.name, c2.email, now, now);

    // 4. Invoke controller getCustomers logic to verify sales calculation
    const mockReq = { user: { id: merchant.id } };
    let resultData = null;
    const mockRes = {
        status: () => mockRes,
        json: (payload) => { resultData = payload; return payload; }
    };

    await crmController.getCustomers(mockReq, mockRes);

    const customersList = resultData.data || [];
    console.log("\nFetched Customers List with Total Sales:");
    customersList.forEach(c => {
        console.log(`- Customer: "${c.name}" | Email: ${c.email} | Total Sales: ₹${c.total_sales}`);
    });

    const alphaItem = customersList.find(c => c.id === c1.id);
    const betaItem = customersList.find(c => c.id === c2.id);

    if (!alphaItem || alphaItem.total_sales !== 8000) {
        throw new Error(`Expected Alpha Buyer total sales to be 8000 (excluding cancelled invoice), got: ${alphaItem?.total_sales}`);
    }

    if (!betaItem || betaItem.total_sales !== 15000) {
        throw new Error(`Expected Beta Buyer total sales to be 15000, got: ${betaItem?.total_sales}`);
    }

    if (customersList[0].id !== c2.id) {
        throw new Error(`Expected highest spender Beta Buyer (₹15,000) to be ordered first, but got ${customersList[0].name}`);
    }

    console.log("\n==================================================================");
    console.log("   ALL TOP CUSTOMER SALES CALCULATIONS PASSED SUCCESSFULLY!");
    console.log("==================================================================");
}

verifyTopCustomerSalesCalculation()
    .then(() => process.exit(0))
    .catch(err => {
        console.error("\n[VERIFICATION FAILED]", err);
        process.exit(1);
    });
