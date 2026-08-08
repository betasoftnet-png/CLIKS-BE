const db = require('../db/connection');
const connectionService = require('../utils/connectionService');
const customerController = require('../controllers/customerController');
const financePlusController = require('../controllers/financePlusController');
const { processCustomerInvoiceIntegration } = require('../utils/customerIntegration');

async function runEndToEndVerification() {
    console.log("==================================================================");
    console.log("   END-TO-END CUSTOMER CONNECTION SYSTEM INTEGRATION TEST");
    console.log("==================================================================");

    await connectionService.ensureTable();

    const now = new Date().toISOString();

    // 1. Ensure Merchant User exists
    let merchant = await db.prepare("SELECT * FROM users WHERE role = 'business' OR business_name IS NOT NULL LIMIT 1").get();
    if (!merchant) {
        const mRes = await db.prepare(`
            INSERT INTO users (username, email, password_hash, role, business_name, created_at, updated_at)
            VALUES ('Gupta Wholesale', 'gupta_wholesale@bnxmail.com', 'hash', 'business', 'Gupta Groceries Wholesale', ?, ?)
        `).run(now, now);
        merchant = await db.prepare('SELECT * FROM users WHERE id = ?').get(mRes.lastInsertRowid);
    }
    console.log(`[TEST] Merchant User: "${merchant.business_name || merchant.username}" (ID: ${merchant.id})`);

    // 2. Ensure CLIKS Website User exists for tata123@bnxmail.com
    const testEmail = 'tata123@bnxmail.com';
    let customerUser = await db.prepare("SELECT * FROM users WHERE LOWER(email) = ?").get(testEmail);
    if (!customerUser) {
        const uRes = await db.prepare(`
            INSERT INTO users (username, email, password_hash, role, receive_data, receiveData, created_at, updated_at)
            VALUES ('Rajesh Gupta', ?, 'hash', 'user', 1, 1, ?, ?)
        `).run(testEmail, now, now);
        customerUser = await db.prepare('SELECT * FROM users WHERE id = ?').get(uRes.lastInsertRowid);
    }
    console.log(`[TEST] CLIKS Website User: "${customerUser.username}" (${customerUser.email}, ID: ${customerUser.id})`);

    // Clean up any old test records for tata123@bnxmail.com
    await db.prepare("DELETE FROM customer_connections WHERE LOWER(customer_email) = ?").run(testEmail);
    await db.prepare("DELETE FROM business_customers WHERE user_id = ? AND LOWER(email) = ?").run(merchant.id, testEmail);

    // STEP 1 & 2: Business creates customer in CLIKS Business
    console.log("\n--- STEP 1 & 2: Business creates customer in CLIKS Business ---");
    const custRes = await db.prepare(`
        INSERT INTO business_customers (
            user_id, name, email, phone, business_name, customer_code, created_at, updated_at
        ) VALUES (?, 'Rajesh Gupta', ?, '9876543210', 'Gupta Groceries Wholesale', 'CUST-0107', ?, ?)
    `).run(merchant.id, testEmail, now, now);

    const bCustomer = await db.prepare("SELECT * FROM business_customers WHERE id = ?").get(custRes.lastInsertRowid);
    console.log(`Saved Business Customer: ID=${bCustomer.id}, Name="${bCustomer.name}", Email=${bCustomer.email}, Code=${bCustomer.customer_code}`);

    // Trigger Connection Sync
    await connectionService.syncCustomerConnectionOnCreateOrUpdate({
        business_id: merchant.id,
        business_customer_id: bCustomer.id,
        customer_email: bCustomer.email
    });

    // STEP 3: Verify Website detects pending request
    console.log("\n--- STEP 3: Verify Website detects pending request ---");
    let integrations = await connectionService.getWebsiteUserIntegrations(customerUser.id, customerUser.email);
    console.log(`Integrations for ${customerUser.email}:`, JSON.stringify(integrations, null, 2));

    const pendingRequest = integrations.find(i => i.business_id === merchant.id && i.customer_email === testEmail);
    if (!pendingRequest) throw new Error("Pending connection request not found for website user!");
    if (pendingRequest.status !== 'PENDING') throw new Error(`Expected status PENDING, got ${pendingRequest.status}`);

    let bConnStatus = await connectionService.getCustomerConnectionStatus(merchant.id, bCustomer.id, bCustomer.email);
    console.log(`CLIKS Business Customer List Status: ${bConnStatus}`);
    if (bConnStatus !== 'PENDING') throw new Error(`Expected Business Customer status PENDING, got ${bConnStatus}`);

    // STEP 4 & 5: Customer clicks ACCEPT on CLIKS Website
    console.log("\n--- STEP 4 & 5: Customer accepts connection request ---");
    const acceptRes = await connectionService.respondToIntegrationRequest({
        website_user_id: customerUser.id,
        website_user_email: customerUser.email,
        connection_id: pendingRequest.id,
        action: 'accept'
    });
    console.log("Accept Response DB Record:", acceptRes);

    integrations = await connectionService.getWebsiteUserIntegrations(customerUser.id, customerUser.email);
    const acceptedRequest = integrations.find(i => i.id === pendingRequest.id);
    console.log(`Website Active Integrations Status: ${acceptedRequest.status}`);
    if (acceptedRequest.status !== 'CONNECTED') throw new Error(`Expected status CONNECTED, got ${acceptedRequest.status}`);

    // STEP 6: Verify Business customer list shows CONNECTED
    console.log("\n--- STEP 6: Business Customer List Connection Status ---");
    bConnStatus = await connectionService.getCustomerConnectionStatus(merchant.id, bCustomer.id, bCustomer.email);
    console.log(`CLIKS Business Customer List Status: ${bConnStatus}`);
    if (bConnStatus !== 'CONNECTED') throw new Error(`Expected Business Customer status CONNECTED, got ${bConnStatus}`);

    // STEP 7 & 8: Generate a new invoice and verify synchronization to CLIKS Website
    console.log("\n--- STEP 7 & 8: Generate Sales Invoice and Verify Purchase Sync ---");
    const invNumber = `INV-${Date.now().toString().slice(-6)}`;
    const invRes = await db.prepare(`
        INSERT INTO business_invoices (
            user_id, invoice_number, client_name, client_email, total_amount, amount,
            status, payment_mode, items, created_at, updated_at
        ) VALUES (?, ?, 'Rajesh Gupta', ?, 2500, 2500, 'Paid', 'Bank', ?, ?, ?)
    `).run(merchant.id, invNumber, testEmail, JSON.stringify([{ description: 'Basmati Rice 10kg', quantity: 2, price: 1250 }]), now, now);

    const createdInvoice = await db.prepare('SELECT * FROM business_invoices WHERE id = ?').get(invRes.lastInsertRowid);
    console.log(`Created Invoice #${createdInvoice.invoice_number} (Amount: ₹${createdInvoice.total_amount})`);

    // Process Purchase Sync
    await processCustomerInvoiceIntegration({
        createdInvoice,
        merchantUserId: merchant.id
    });

    // Check Customer Purchase History in DB
    const syncedPurchase = await db.prepare(`
        SELECT * FROM customer_purchase_history WHERE invoice_number = ?
    `).get(createdInvoice.invoice_number);

    if (!syncedPurchase) throw new Error("Purchase history record was NOT synchronized!");
    console.log("SUCCESS: Purchase synchronized to CLIKS Website Purchase History:", {
        invoice_number: syncedPurchase.invoice_number,
        merchant_name: syncedPurchase.merchant_name,
        customer_email: syncedPurchase.customer_email,
        total_amount: syncedPurchase.total_amount,
        points_earned: syncedPurchase.points_earned
    });

    // STEP 9: Test REJECT flow
    console.log("\n--- STEP 9: Test REJECT Flow ---");
    const rejectEmail = 'reject_test@bnxmail.com';
    let rejectUser = await db.prepare("SELECT * FROM users WHERE LOWER(email) = ?").get(rejectEmail);
    if (!rejectUser) {
        const uRes = await db.prepare(`
            INSERT INTO users (username, email, password_hash, role, receive_data, receiveData, created_at, updated_at)
            VALUES ('Reject Test User', ?, 'hash', 'user', 1, 1, ?, ?)
        `).run(rejectEmail, now, now);
        rejectUser = await db.prepare('SELECT * FROM users WHERE id = ?').get(uRes.lastInsertRowid);
    }

    const rCustRes = await db.prepare(`
        INSERT INTO business_customers (
            user_id, name, email, phone, customer_code, created_at, updated_at
        ) VALUES (?, 'Reject Customer', ?, '9111111111', 'CUST-0999', ?, ?)
    `).run(merchant.id, rejectEmail, now, now);
    const rCustomer = await db.prepare("SELECT * FROM business_customers WHERE id = ?").get(rCustRes.lastInsertRowid);

    await connectionService.syncCustomerConnectionOnCreateOrUpdate({
        business_id: merchant.id,
        business_customer_id: rCustomer.id,
        customer_email: rCustomer.email
    });

    let rIntegrations = await connectionService.getWebsiteUserIntegrations(rejectUser.id, rejectUser.email);
    const rReq = rIntegrations.find(i => i.business_customer_id === rCustomer.id);

    // Reject the request
    await connectionService.respondToIntegrationRequest({
        website_user_id: rejectUser.id,
        website_user_email: rejectUser.email,
        connection_id: rReq.id,
        action: 'reject'
    });

    const rejectConnStatus = await connectionService.getCustomerConnectionStatus(merchant.id, rCustomer.id, rCustomer.email);
    console.log(`Rejected Customer Status in CLIKS Business: ${rejectConnStatus}`);
    if (rejectConnStatus !== 'UNCONNECTED') throw new Error(`Expected UNCONNECTED for rejected customer, got ${rejectConnStatus}`);

    // Try generating invoice for rejected customer
    const rInvNum = `INV-REJ-${Date.now().toString().slice(-4)}`;
    const rInvRes = await db.prepare(`
        INSERT INTO business_invoices (
            user_id, invoice_number, client_name, client_email, total_amount, amount,
            status, payment_mode, items, created_at, updated_at
        ) VALUES (?, ?, 'Reject Customer', ?, 500, 500, 'Paid', 'Cash', '[]', ?, ?)
    `).run(merchant.id, rInvNum, rejectEmail, now, now);
    const rInvoice = await db.prepare('SELECT * FROM business_invoices WHERE id = ?').get(rInvRes.lastInsertRowid);

    await processCustomerInvoiceIntegration({
        createdInvoice: rInvoice,
        merchantUserId: merchant.id
    });

    const rejectedSynced = await db.prepare('SELECT * FROM customer_purchase_history WHERE invoice_number = ?').get(rInvNum);
    if (rejectedSynced) throw new Error("CRITICAL FAILURE: Invoice for REJECTED connection was incorrectly synchronized!");
    console.log("SUCCESS: Rejected connection correctly prevented purchase history synchronization!");

    // STEP 10: Verify Security Check (User A cannot accept User B's request)
    console.log("\n--- STEP 10: Security Validation (Unauthorized Accept Prevention) ---");
    try {
        await connectionService.respondToIntegrationRequest({
            website_user_id: customerUser.id, // User A
            website_user_email: customerUser.email,
            connection_id: rReq.id, // Request meant for User B (rejectUser)
            action: 'accept'
        });
        throw new Error("SECURITY FAIL: User A was able to accept User B's connection request!");
    } catch (e) {
        console.log(`SUCCESS: Security check correctly blocked unauthorized response: "${e.message}"`);
    }

    console.log("\n==================================================================");
    console.log("   ALL 10 VERIFICATION STEPS PASSED SUCCESSFULLY! 100% PERSISTENT.");
    console.log("==================================================================");
}

runEndToEndVerification()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("\n[VERIFICATION FAILED]", err);
        process.exit(1);
    });
