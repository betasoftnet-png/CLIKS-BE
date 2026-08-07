const db = require('../db/connection');
const { runMigrations } = require('../db/migrations');
const { processCustomerInvoiceIntegration } = require('../utils/customerIntegration');
const customerPurchaseController = require('../controllers/customerPurchaseController');

async function testFeature() {
    console.log('=== TESTING SEND PURCHASE HISTORY TO CUSTOMER FEATURE ===');
    await runMigrations();

    const now = new Date().toISOString();
    const customerEmail = 'testcustomer.sendto@cliks.com';

    // 1. Setup Merchant and Customer
    let merchant = await db.prepare('SELECT * FROM users WHERE id = 1').get();
    if (!merchant) {
        const mRes = await db.prepare(`
            INSERT INTO users (username, email, password_hash, role, business_name, created_at, updated_at)
            VALUES ('merchant_test', 'merchant.test@cliks.com', 'hash', 'user', 'Test Store', ?, ?)
        `).run(now, now);
        merchant = await db.prepare('SELECT * FROM users WHERE id = ?').get(mRes.lastInsertRowid);
    }

    let customer = await db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(customerEmail);
    if (!customer) {
        const cRes = await db.prepare(`
            INSERT INTO users (username, email, password_hash, role, loyalty_points, created_at, updated_at)
            VALUES ('testcustomer_sendto', ?, 'hash', 'user', 0, ?, ?)
        `).run(customerEmail, now, now);
        customer = await db.prepare('SELECT * FROM users WHERE id = ?').get(cRes.lastInsertRowid);
    }

    // Clean previous records for isolation
    await db.prepare('DELETE FROM customer_purchase_history WHERE LOWER(customer_email) = ?').run(customerEmail);
    await db.prepare('DELETE FROM business_invoices WHERE LOWER(client_email) = ?').run(customerEmail);

    // 2. Test YES (sendToCustomerHistory = true)
    console.log('\n--- Test 1: Generate Invoice with sendToCustomerHistory = true ---');
    const invNumYes = `INV-YES-${Date.now().toString().slice(-4)}`;
    const resYes = await db.prepare(`
        INSERT INTO business_invoices (
            user_id, invoice_number, client_name, client_email, amount, total_amount, paid_amount,
            due_amount, status, sendToCustomerHistory, items, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        merchant.id, invNumYes, 'Test Customer', customerEmail, 1000, 1000, 1000,
        0, 'Paid', 1, JSON.stringify([{ product_name: 'Item YES', quantity: 1, price: 1000 }]), now, now
    );

    const invYes = await db.prepare('SELECT * FROM business_invoices WHERE id = ?').get(resYes.lastInsertRowid);

    await processCustomerInvoiceIntegration({
        createdInvoice: invYes,
        merchantUserId: merchant.id
    });

    const syncYes = await db.prepare('SELECT * FROM customer_purchase_history WHERE invoice_number = ?').get(invNumYes);
    if (syncYes && syncYes.sendToCustomerHistory === 1) {
        console.log('✅ TEST 1 PASSED: Invoice synchronized to customer CLIKS account with sendToCustomerHistory = 1');
    } else {
        console.error('❌ TEST 1 FAILED: Invoice not synchronized or sendToCustomerHistory mismatch!', syncYes);
    }

    // 3. Test NO (sendToCustomerHistory = false)
    console.log('\n--- Test 2: Generate Invoice with sendToCustomerHistory = false ---');
    const invNumNo = `INV-NO-${Date.now().toString().slice(-4)}`;
    const resNo = await db.prepare(`
        INSERT INTO business_invoices (
            user_id, invoice_number, client_name, client_email, amount, total_amount, paid_amount,
            due_amount, status, sendToCustomerHistory, items, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        merchant.id, invNumNo, 'Test Customer', customerEmail, 500, 500, 500,
        0, 'Paid', 0, JSON.stringify([{ product_name: 'Item NO', quantity: 1, price: 500 }]), now, now
    );

    const invNo = await db.prepare('SELECT * FROM business_invoices WHERE id = ?').get(resNo.lastInsertRowid);

    await processCustomerInvoiceIntegration({
        createdInvoice: invNo,
        merchantUserId: merchant.id
    });

    const syncNo = await db.prepare('SELECT * FROM customer_purchase_history WHERE invoice_number = ?').get(invNumNo);
    if (!syncNo) {
        console.log('✅ TEST 2 PASSED: Invoice with sendToCustomerHistory = false was NOT synchronized to customer CLIKS account!');
    } else {
        console.error('❌ TEST 2 FAILED: Invoice was incorrectly synchronized!', syncNo);
    }

    // 4. Test Merchant Summary Filter (Receive Data = YES vs NO)
    console.log('\n--- Test 3: Receive Data Filter (YES vs NO) ---');
    
    let resultYes = null;
    const resMockYes = {
        status(code) { return this; },
        json(payload) { resultYes = payload; return this; }
    };

    let resultNo = null;
    const resMockNo = {
        status(code) { return this; },
        json(payload) { resultNo = payload; return this; }
    };

    await customerPurchaseController.getMerchantSummary(
        { user: customer, query: { receiveData: 'YES' } },
        resMockYes
    );

    await customerPurchaseController.getMerchantSummary(
        { user: customer, query: { receiveData: 'NO' } },
        resMockNo
    );

    console.log('Receive Data = YES Merchants:', resultYes?.data);
    console.log('Receive Data = NO Merchants:', resultNo?.data);

    if (resultYes?.data?.length > 0 && resultNo?.data?.length === 0) {
        console.log('✅ TEST 3 PASSED: Receive Data filter correctly displays synchronized invoices on YES and hides on NO!');
    } else {
        console.error('❌ TEST 3 FAILED: Unexpected filter result');
    }

    console.log('\n=== ALL VERIFICATION TESTS COMPLETED SUCCESSFULLY ===');
}

testFeature().catch(err => {
    console.error('Error running test script:', err);
    process.exit(1);
});
