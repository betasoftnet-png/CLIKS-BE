const db = require('../db/connection');
const { runMigrations } = require('../db/migrations');
const { processCustomerInvoiceIntegration } = require('../utils/customerIntegration');
const customerPurchaseController = require('../controllers/customerPurchaseController');

async function testDineshSync() {
    console.log('=== TESTING COMPLETE INVOICE SYNC FOR dineshkumar90@bnxmail.com ===');
    await runMigrations();

    const now = new Date().toISOString();
    const customerEmail = 'dineshkumar90@bnxmail.com';

    // 1. Fetch merchant user
    let merchant = await db.prepare('SELECT * FROM users WHERE id = 1').get();
    if (!merchant) {
        const mRes = await db.prepare(`
            INSERT INTO users (username, email, password_hash, role, business_name, created_at, updated_at)
            VALUES ('merchant_store', 'merchant@store.com', 'hash', 'user', 'SuperStore Retail', ?, ?)
        `).run(now, now);
        merchant = await db.prepare('SELECT * FROM users WHERE id = ?').get(mRes.lastInsertRowid);
    }

    // 2. Simulate Invoice Generation from CLIKS Business with Send Purchase History to Customer = YES
    console.log('\n--- 1. Generating Invoice in CLIKS Business ---');
    const invNum = `INV-DINESH-${Date.now().toString().slice(-4)}`;
    const invRes = await db.prepare(`
        INSERT INTO business_invoices (
            user_id, invoice_number, client_name, client_email, amount, tax_amount, total_amount, paid_amount,
            due_amount, status, sendPurchaseHistoryToCustomer, sendToCustomerHistory, items, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        merchant.id, invNum, 'Dinesh Kumar', customerEmail, 2500, 450, 2950, 2950,
        0, 'Paid', 1, 1, JSON.stringify([
            { product_name: 'Wireless Ergonomic Keyboard', quantity: 1, price: 1500, tax_rate: 18, total: 1770 },
            { product_name: 'Optical Gaming Mouse', quantity: 1, price: 1000, tax_rate: 18, total: 1180 }
        ]), now, now
    );

    const createdInvoice = await db.prepare('SELECT * FROM business_invoices WHERE id = ?').get(invRes.lastInsertRowid);
    console.log('Saved Invoice in Business DB:', {
        id: createdInvoice.id,
        invoice_number: createdInvoice.invoice_number,
        client_name: createdInvoice.client_name,
        client_email: createdInvoice.client_email,
        sendPurchaseHistoryToCustomer: createdInvoice.sendPurchaseHistoryToCustomer,
        sendToCustomerHistory: createdInvoice.sendToCustomerHistory,
        total_amount: createdInvoice.total_amount
    });

    // 3. Trigger Real-Time Synchronization Engine
    console.log('\n--- 2. Triggering Real-Time Customer Integration Engine ---');
    await processCustomerInvoiceIntegration({
        createdInvoice,
        merchantUserId: merchant.id
    });

    // 4. Verify Customer Record in users table
    const customerUser = await db.prepare('SELECT id, username, email, receive_data, loyalty_points FROM users WHERE LOWER(email) = ?').get(customerEmail);
    console.log('\n--- 3. Customer User Record in CLIKS Database ---');
    console.log(customerUser);

    // 5. Verify Customer Purchase History Table
    const purchaseRecords = await db.prepare('SELECT id, invoice_number, merchant_name, customer_email, net_amount, points_earned FROM customer_purchase_history WHERE LOWER(customer_email) = ?').all(customerEmail);
    console.log('\n--- 4. Purchase History Records ---');
    console.log(purchaseRecords);

    // 6. Simulate CLIKS Website API Query (getPurchaseHistory)
    console.log('\n--- 5. Simulating CLIKS Website Purchase Details API (getPurchaseHistory) ---');
    let historyApiResponse = null;
    await customerPurchaseController.getPurchaseHistory(
        { user: customerUser, query: { receiveData: 'YES' } },
        {
            status() { return this; },
            json(payload) { historyApiResponse = payload; return this; }
        }
    );
    console.log('API Response (Purchase Details):', historyApiResponse);

    // 7. Simulate CLIKS Website API Query (getMerchantSummary)
    console.log('\n--- 6. Simulating CLIKS Website Merchant Summary API (getMerchantSummary) ---');
    let merchantApiResponse = null;
    await customerPurchaseController.getMerchantSummary(
        { user: customerUser, query: { receiveData: 'YES' } },
        {
            status() { return this; },
            json(payload) { merchantApiResponse = payload; return this; }
        }
    );
    console.log('API Response (Merchant Summary Cards):', merchantApiResponse);

    // Assertions
    if (customerUser && purchaseRecords.length > 0 && historyApiResponse?.data?.length > 0 && merchantApiResponse?.data?.length > 0) {
        console.log('\n✅ VERIFICATION SUCCESSFUL: Invoice for dineshkumar90@bnxmail.com synchronized immediately to CLIKS Website!');
    } else {
        console.error('\n❌ VERIFICATION FAILED!');
    }
}

testDineshSync().catch(err => console.error(err));
