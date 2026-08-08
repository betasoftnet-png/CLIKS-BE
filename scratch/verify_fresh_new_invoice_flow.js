const db = require('../db/connection');
const billingController = require('../controllers/billingController');
const financePlusController = require('../controllers/financePlusController');

async function verifyFreshNewInvoiceFlow() {
    console.log("==================================================================");
    console.log("   VERIFYING FRESH NEW INVOICE SYNC & PURCHASE DETAILS DISPLAY");
    console.log("==================================================================");

    const now = new Date();
    const invNum = `INV-${Math.floor(100000 + Math.random() * 900000)}`;

    // Merchant sanjay123 (ID: 7)
    const merchant = await db.prepare("SELECT * FROM users WHERE LOWER(username) = 'sanjay123'").get();
    // Website Customer tata123 (ID: 26)
    const websiteUser = await db.prepare("SELECT * FROM users WHERE LOWER(email) = 'tata123@bnxmail.com'").get();

    console.log(`Merchant: ${merchant.username} (ID: ${merchant.id})`);
    console.log(`Customer: ${websiteUser.username} (ID: ${websiteUser.id}, Email: ${websiteUser.email})`);
    console.log(`Generating NEW Invoice: ${invNum} for ₹15,500 (PAID)...`);

    const invPayload = {
        invoice_number: invNum,
        client_name: 'santhosh',
        client_email: 'tata123@bnxmail.com',
        amount: 15500,
        total_amount: 15500,
        paid_amount: 15500,
        due_amount: 0,
        status: 'Paid',
        payment_mode: 'UPI',
        invoice_type: 'GST',
        items: [
            { description: 'Smart LED TV 43 Inch', quantity: 1, price: 15500, tax_rate: 18, total: 15500 }
        ]
    };

    let req = { user: { id: merchant.id }, body: invPayload };
    let createRes = null;
    let resMock = {
        status: (code) => resMock,
        json: (payload) => { createRes = payload; return payload; }
    };

    await billingController.createInvoice(req, resMock);
    console.log(`[API RESPONSE] ${createRes?.message}`);

    // Check business_invoices DB table
    const invInDb = await db.prepare("SELECT * FROM business_invoices WHERE invoice_number = ?").get(invNum);
    if (!invInDb) throw new Error(`CRITICAL: ${invNum} was NOT saved in business_invoices DB!`);
    console.log(`[BUSINESS DB] Saved invoice ${invInDb.invoice_number} (ID: ${invInDb.id}, Amount: ₹${invInDb.total_amount})`);

    // Check customer_purchase_history DB table
    const syncInDb = await db.prepare("SELECT * FROM customer_purchase_history WHERE invoice_number = ?").get(invNum);
    if (!syncInDb) throw new Error(`CRITICAL: ${invNum} was NOT synchronized into customer_purchase_history DB!`);
    console.log(`[SYNC DB] Synced invoice ${syncInDb.invoice_number} (Merchant: ${syncInDb.merchant_name}, Amount: ₹${syncInDb.total_amount}, Points: ${syncInDb.points_earned})`);

    // Query Website API endpoint GET /api/v1/finance-plus/purchases for tata123
    let apiResp = null;
    let webResMock = {
        setHeader: () => {},
        status: (code) => webResMock,
        json: (payload) => { apiResp = payload; return payload; }
    };
    await financePlusController.getCustomerPurchases({ user: { id: websiteUser.id, email: websiteUser.email } }, webResMock);

    const purchaseList = apiResp?.data || [];
    const matchedInv = purchaseList.find(p => p.invoice_number === invNum);

    if (!matchedInv) throw new Error(`CRITICAL: ${invNum} was NOT returned by Website /api/v1/finance-plus/purchases API!`);

    console.log(`[WEBSITE API SUCCESS] ${invNum} is present in Website Purchase History API response:`);
    console.log({
        invoice_number: matchedInv.invoice_number,
        merchant_name: matchedInv.merchant_name,
        customer_name: matchedInv.customer_name,
        grand_total: matchedInv.grand_total,
        points_earned: matchedInv.points_earned,
        purchase_status: matchedInv.purchase_status,
        timestamp: matchedInv.timestamp
    });

    console.log("\n==================================================================");
    console.log("   FRESH NEW INVOICE SYNC & PURCHASE API VERIFICATION PASSED 100%!");
    console.log("==================================================================");
}

verifyFreshNewInvoiceFlow().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
