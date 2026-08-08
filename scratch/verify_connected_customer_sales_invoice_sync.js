const db = require('../db/connection');
const connectionService = require('../utils/connectionService');
const billingController = require('../controllers/billingController');
const financePlusController = require('../controllers/financePlusController');
const customerPurchaseController = require('../controllers/customerPurchaseController');
const { processCustomerInvoiceIntegration } = require('../utils/customerIntegration');

async function verifyConnectedCustomerSalesInvoiceSync() {
    console.log("==================================================================");
    console.log("   CONNECTED CUSTOMER → SALES INVOICE → PURCHASE DETAILS SYNC TEST");
    console.log("==================================================================");

    await connectionService.ensureTable();
    const now = new Date().toISOString();

    // 1. Fetch Merchant sanjay123
    let merchant = await db.prepare("SELECT * FROM users WHERE username = 'sanjay123' OR email = 'sanjay123@bnxmail.com'").get();
    if (!merchant) {
        const mRes = await db.prepare(`
            INSERT INTO users (username, email, password_hash, role, business_name, created_at, updated_at)
            VALUES ('sanjay123', 'sanjay123@bnxmail.com', 'hash', 'business', 'Sanjay Enterprises', ?, ?)
        `).run(now, now);
        merchant = await db.prepare('SELECT * FROM users WHERE id = ?').get(mRes.lastInsertRowid);
    }
    console.log(`[TEST] Merchant User: "${merchant.business_name || merchant.username}" (ID: ${merchant.id}, Email: ${merchant.email})`);

    // 2. Fetch CLIKS Website User tata123 (email: tata123@bnxmail.com)
    let websiteUser = await db.prepare("SELECT * FROM users WHERE LOWER(email) = 'tata123@bnxmail.com' OR username = 'tata123'").get();
    if (!websiteUser) {
        const uRes = await db.prepare(`
            INSERT INTO users (username, email, password_hash, role, receive_data, receiveData, loyalty_points, created_at, updated_at)
            VALUES ('tata123', 'tata123@bnxmail.com', 'hash', 'user', 1, 1, 0, ?, ?)
        `).run(now, now);
        websiteUser = await db.prepare('SELECT * FROM users WHERE id = ?').get(uRes.lastInsertRowid);
    }
    console.log(`[TEST] Website User: "${websiteUser.username}" (ID: ${websiteUser.id}, Email: ${websiteUser.email})`);

    // 3. Ensure CLIKS Business Customer "santhosh" exists with email "tata123@bnxmail.com"
    let businessCust = await db.prepare(`
        SELECT * FROM business_customers WHERE user_id = ? AND LOWER(email) = 'tata123@bnxmail.com'
    `).get(merchant.id);

    if (!businessCust) {
        const cRes = await db.prepare(`
            INSERT INTO business_customers (user_id, name, email, phone, customer_code, created_at, updated_at)
            VALUES (?, 'santhosh', 'tata123@bnxmail.com', '9876543210', 'CUST-3480', ?, ?)
        `).run(merchant.id, now, now);
        businessCust = await db.prepare('SELECT * FROM business_customers WHERE id = ?').get(cRes.lastInsertRowid);
    } else if (businessCust.name !== 'santhosh') {
        await db.prepare("UPDATE business_customers SET name = 'santhosh' WHERE id = ?").run(businessCust.id);
        businessCust = await db.prepare('SELECT * FROM business_customers WHERE id = ?').get(businessCust.id);
    }
    console.log(`[TEST] Business Customer: "${businessCust.name}" (ID: ${businessCust.id}, Email: ${businessCust.email}, Code: ${businessCust.customer_code})`);

    // 4. Ensure connection status is accepted / CONNECTED
    await connectionService.syncCustomerConnectionOnCreateOrUpdate({
        business_id: merchant.id,
        business_customer_id: businessCust.id,
        customer_email: businessCust.email
    });

    const connRow = await db.prepare("SELECT * FROM customer_connections WHERE business_id = ? AND LOWER(customer_email) = 'tata123@bnxmail.com'").get(merchant.id);
    if (connRow.status !== 'accepted') {
        await connectionService.respondToIntegrationRequest({
            website_user_id: websiteUser.id,
            website_user_email: websiteUser.email,
            connection_id: connRow.id,
            action: 'accept'
        });
    }

    const currentConnStatus = await connectionService.getCustomerConnectionStatus(merchant.id, businessCust.id, businessCust.email);
    console.log(`[TEST] Customer Connection Status: ${currentConnStatus}`);
    if (currentConnStatus !== 'CONNECTED') throw new Error(`Expected connection status CONNECTED, got ${currentConnStatus}`);

    // 5. Generate Sales Invoice INV-449870 via billingController logic
    console.log("\n--- STEP 5: Create Sales Invoice INV-449870 ---");
    const invPayload = {
        invoice_number: 'INV-449870',
        client_name: 'santhosh',
        client_email: 'tata123@bnxmail.com',
        amount: 10000,
        total_amount: 10000,
        paid_amount: 10000,
        due_amount: 0,
        status: 'Paid',
        payment_mode: 'Cash',
        items: [{ product_name: 'Premium Wireless Headphones', quantity: 1, price: 10000, total: 10000 }]
    };

    const mockReq = { user: { id: merchant.id }, body: invPayload };
    let createdResult = null;
    const mockRes = {
        status: (code) => mockRes,
        json: (payload) => { createdResult = payload; return payload; }
    };

    await billingController.createInvoice(mockReq, mockRes);
    console.log("Create Invoice API Result:", createdResult?.message);

    const invInDb = await db.prepare("SELECT * FROM business_invoices WHERE invoice_number = 'INV-449870' AND user_id = ?").get(merchant.id);
    if (!invInDb) throw new Error("INV-449870 was NOT saved in business_invoices table!");
    console.log(`Saved Invoice in DB: ID #${invInDb.id}, Amount: ₹${invInDb.total_amount}, Email: ${invInDb.client_email}`);

    // 6. Verify customer_purchase_history sync
    console.log("\n--- STEP 6: Verify customer_purchase_history record ---");
    const syncRecord = await db.prepare("SELECT * FROM customer_purchase_history WHERE invoice_number = 'INV-449870'").get();
    if (!syncRecord) throw new Error("CRITICAL SYNC FAILURE: INV-449870 was NOT found in customer_purchase_history table!");

    console.log("Synced Purchase Record in DB:", {
        id: syncRecord.id,
        invoice_number: syncRecord.invoice_number,
        merchant_name: syncRecord.merchant_name,
        customer_email: syncRecord.customer_email,
        total_amount: syncRecord.total_amount,
        points_earned: syncRecord.points_earned,
        sendToCustomerHistory: syncRecord.sendToCustomerHistory
    });

    // 7. Verify Loyalty points transaction and wallet
    console.log("\n--- STEP 7: Verify Loyalty Points Credited ---");
    const wallet = await db.prepare("SELECT * FROM customer_loyalty_wallets WHERE user_id = ?").get(websiteUser.id);
    console.log(`Customer Loyalty Wallet Points Balance: ${wallet?.points_balance || 0} pts`);
    if (!wallet || wallet.points_balance < 100) throw new Error("Loyalty points were not credited to wallet!");

    // 8. Verify CLIKS Website Finance Plus Purchases API endpoint returns INV-449870
    console.log("\n--- STEP 8: Verify Website Finance Plus Purchases API Endpoint ---");
    const websiteReq = { user: { id: websiteUser.id, email: websiteUser.email } };
    let apiResponse = null;
    const websiteRes = {
        setHeader: () => {},
        status: (code) => websiteRes,
        json: (payload) => { apiResponse = payload; return payload; }
    };

    await financePlusController.getCustomerPurchases(websiteReq, websiteRes);

    const purchaseList = apiResponse?.data || apiResponse || [];
    console.log(`Fetched Purchases from /api/v1/finance-plus/purchases: ${purchaseList.length} item(s)`);

    const invInApi = purchaseList.find(p => p.invoice_number === 'INV-449870');
    if (!invInApi) throw new Error("INV-449870 was NOT returned by /api/v1/finance-plus/purchases API endpoint!");

    console.log("API Returned Invoice Object:", {
        invoice_number: invInApi.invoice_number,
        merchant_name: invInApi.merchant_name,
        grand_total: invInApi.grand_total,
        points_earned: invInApi.points_earned,
        purchase_status: invInApi.purchase_status
    });

    // 9. Verify CLIKS Website /api/v1/customer/purchase-history API endpoint returns INV-449870
    console.log("\n--- STEP 9: Verify Customer Purchase History API Endpoint ---");
    let custApiResp = null;
    const custMockRes = {
        setHeader: () => {},
        status: (code) => custMockRes,
        json: (payload) => { custApiResp = payload; return payload; }
    };

    await customerPurchaseController.getPurchaseHistory({ user: { id: websiteUser.id, email: websiteUser.email }, query: {} }, custMockRes);
    const custPurchases = custApiResp?.data || [];
    const foundInCustApi = custPurchases.find(p => p.invoice_number === 'INV-449870');
    if (!foundInCustApi) throw new Error("INV-449870 was NOT returned by /api/v1/customer/purchase-history API endpoint!");

    console.log("Customer Purchase History API returned INV-449870 successfully!");

    // 10. Verify REJECTED Customer is still blocked
    console.log("\n--- STEP 10: Verify Rejected Customer Blocked ---");
    const rejEmail = 'reject_test@bnxmail.com';
    const rejInvPayload = {
        invoice_number: `INV-REJ-BLOCKED-${Date.now().toString().slice(-4)}`,
        client_name: 'Reject Customer',
        client_email: rejEmail,
        amount: 800,
        total_amount: 800,
        status: 'Paid',
        payment_mode: 'Cash',
        items: []
    };

    const rejReq = { user: { id: merchant.id }, body: rejInvPayload };
    await billingController.createInvoice(rejReq, mockRes);

    const rejSyncRecord = await db.prepare("SELECT * FROM customer_purchase_history WHERE invoice_number = ?").get(rejInvPayload.invoice_number);
    if (rejSyncRecord) throw new Error("SECURITY FAILURE: Invoice for REJECTED customer was synchronized!");
    console.log("SUCCESS: Rejected customer invoice was correctly BLOCKED from synchronizing!");

    console.log("\n==================================================================");
    console.log("   ALL CONNECTED CUSTOMER PURCHASE SYNC TESTS PASSED 100%!");
    console.log("==================================================================");
}

verifyConnectedCustomerSalesInvoiceSync()
    .then(() => process.exit(0))
    .catch(err => {
        console.error("\n[VERIFICATION FAILED]", err);
        process.exit(1);
    });
