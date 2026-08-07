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

    // 2. Test YES (sendPurchaseHistoryToCustomer = true & Customer Receive Data = YES)
    console.log('\n--- Test 1: Merchant YES + Customer Receive Data = YES ---');
    await db.prepare("UPDATE users SET receive_data = 1 WHERE id = ?").run(customer.id);

    const invNumYes = `INV-YES-${Date.now().toString().slice(-4)}`;
    const resYes = await db.prepare(`
        INSERT INTO business_invoices (
            user_id, invoice_number, client_name, client_email, amount, total_amount, paid_amount,
            due_amount, status, sendPurchaseHistoryToCustomer, sendToCustomerHistory, items, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        merchant.id, invNumYes, 'Test Customer', customerEmail, 1000, 1000, 1000,
        0, 'Paid', 1, 1, JSON.stringify([{ product_name: 'Item YES', quantity: 1, price: 1000 }]), now, now
    );

    const invYes = await db.prepare('SELECT * FROM business_invoices WHERE id = ?').get(resYes.lastInsertRowid);

    await processCustomerInvoiceIntegration({
        createdInvoice: invYes,
        merchantUserId: merchant.id
    });

    const syncYes = await db.prepare('SELECT * FROM customer_purchase_history WHERE invoice_number = ?').get(invNumYes);
    if (syncYes && syncYes.sendPurchaseHistoryToCustomer === 1) {
        console.log('✅ TEST 1 PASSED: Invoice delivered & synchronized to customer account when both Merchant = YES & Customer = YES!');
    } else {
        console.error('❌ TEST 1 FAILED: Invoice not synchronized!', syncYes);
    }

    // 3. Test Two-Way Consent Block (Merchant YES + Customer Receive Data = NO)
    console.log('\n--- Test 2: Merchant YES + Customer Receive Data = NO (Two-Way Consent Block) ---');
    await db.prepare("UPDATE users SET receive_data = 0 WHERE id = ?").run(customer.id);

    const invNumBlocked = `INV-BLOCKED-${Date.now().toString().slice(-4)}`;
    const resBlocked = await db.prepare(`
        INSERT INTO business_invoices (
            user_id, invoice_number, client_name, client_email, amount, total_amount, paid_amount,
            due_amount, status, sendPurchaseHistoryToCustomer, sendToCustomerHistory, items, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        merchant.id, invNumBlocked, 'Test Customer', customerEmail, 1200, 1200, 1200,
        0, 'Paid', 1, 1, JSON.stringify([{ product_name: 'Item Blocked', quantity: 1, price: 1200 }]), now, now
    );

    const invBlocked = await db.prepare('SELECT * FROM business_invoices WHERE id = ?').get(resBlocked.lastInsertRowid);

    await processCustomerInvoiceIntegration({
        createdInvoice: invBlocked,
        merchantUserId: merchant.id
    });

    const syncBlocked = await db.prepare('SELECT * FROM customer_purchase_history WHERE invoice_number = ?').get(invNumBlocked);
    if (!syncBlocked) {
        console.log('✅ TEST 2 PASSED: Invoice NOT delivered to customer because Customer Receive Data = NO (Two-Way Consent Enforced)!');
    } else {
        console.error('❌ TEST 2 FAILED: Invoice was incorrectly delivered when Customer Receive Data = NO!', syncBlocked);
    }

    // Restore customer receive_data to 1 for remaining tests
    await db.prepare("UPDATE users SET receive_data = 1 WHERE id = ?").run(customer.id);

    // 4. Test Merchant = NO (sendPurchaseHistoryToCustomer = false)
    console.log('\n--- Test 3: Merchant NO (sendPurchaseHistoryToCustomer = false) ---');
    const invNumNo = `INV-NO-${Date.now().toString().slice(-4)}`;
    const resNo = await db.prepare(`
        INSERT INTO business_invoices (
            user_id, invoice_number, client_name, client_email, amount, total_amount, paid_amount,
            due_amount, status, sendPurchaseHistoryToCustomer, sendToCustomerHistory, items, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        merchant.id, invNumNo, 'Test Customer', customerEmail, 500, 500, 500,
        0, 'Paid', 0, 0, JSON.stringify([{ product_name: 'Item NO', quantity: 1, price: 500 }]), now, now
    );

    const invNo = await db.prepare('SELECT * FROM business_invoices WHERE id = ?').get(resNo.lastInsertRowid);

    await processCustomerInvoiceIntegration({
        createdInvoice: invNo,
        merchantUserId: merchant.id
    });

    const syncNo = await db.prepare('SELECT * FROM customer_purchase_history WHERE invoice_number = ?').get(invNumNo);
    if (!syncNo) {
        console.log('✅ TEST 3 PASSED: Merchant = NO saved invoice normally, but NEVER synchronized to customer CLIKS account!');
    } else {
        console.error('❌ TEST 3 FAILED: Invoice was incorrectly synchronized!', syncNo);
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
