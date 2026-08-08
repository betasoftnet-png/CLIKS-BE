const db = require('../db/connection');
const billingController = require('../controllers/billingController');
const financePlusController = require('../controllers/financePlusController');

async function testLiveInvoiceCreation() {
    console.log("==================================================================");
    console.log("   LIVE INVOICE CREATION & PURCHASE DETAILS DISPLAY TEST");
    console.log("==================================================================");

    // 1. Get Merchant User (sanjay123, ID: 7)
    const merchant = await db.prepare("SELECT * FROM users WHERE LOWER(username) = 'sanjay123'").get();
    console.log("Merchant User:", merchant.id, merchant.username, merchant.email);

    // 2. Get Website User (tata123, ID: 26)
    const websiteUser = await db.prepare("SELECT * FROM users WHERE LOWER(email) = 'tata123@bnxmail.com'").get();
    console.log("Website User:", websiteUser.id, websiteUser.username, websiteUser.email);

    // 3. Check Connection status
    const conn = await db.prepare("SELECT * FROM customer_connections WHERE business_id = ? AND LOWER(customer_email) = 'tata123@bnxmail.com'").get(merchant.id);
    console.log("Connection Record in DB:", conn);

    // 4. Create new invoice INV-798706 for santhosh (tata123@bnxmail.com)
    const invPayload = {
        invoice_number: 'INV-798706',
        client_name: 'santhosh',
        client_email: 'tata123@bnxmail.com',
        amount: 17000,
        total_amount: 17000,
        paid_amount: 17000,
        due_amount: 0,
        status: 'Paid',
        payment_mode: 'Cash',
        invoice_type: 'GST',
        items: [
            { description: 'Executive Office Desk', quantity: 1, price: 17000, tax_rate: 18, total: 17000 }
        ]
    };

    console.log("\nSimulating POST /api/v1/billing/invoices for INV-798706...");
    let req = { user: { id: merchant.id }, body: invPayload };
    let createRes = null;
    let resMock = {
        status: (code) => resMock,
        json: (payload) => { createRes = payload; return payload; }
    };

    await billingController.createInvoice(req, resMock);
    console.log("Create Invoice Response:", createRes?.message, createRes?.data?.invoice_number);

    // 5. Query customer_purchase_history in DB
    const syncRecord = await db.prepare("SELECT * FROM customer_purchase_history WHERE invoice_number = 'INV-798706'").get();
    console.log("\nSynced Record in customer_purchase_history:", syncRecord);

    // 6. Query Website Purchases API for tata123
    let apiResp = null;
    let webResMock = {
        setHeader: () => {},
        status: (code) => webResMock,
        json: (payload) => { apiResp = payload; return payload; }
    };
    await financePlusController.getCustomerPurchases({ user: { id: websiteUser.id, email: websiteUser.email } }, webResMock);

    console.log("\nWebsite Purchases API Returned Count:", apiResp?.data?.length);
    const match = (apiResp?.data || []).find(p => p.invoice_number === 'INV-798706');
    console.log("Is INV-798706 in Website Purchases API response?", !!match);
    if (match) {
        console.log("Matched Invoice Details:", match);
    }
}

testLiveInvoiceCreation().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
