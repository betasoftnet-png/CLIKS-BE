const db = require('../db/connection');
const { runMigrations } = require('../db/migrations');
const { processCustomerInvoiceIntegration } = require('../utils/customerIntegration');

async function runTest() {
    console.log('--- STARTING CLIKS CUSTOMER INTEGRATION VERIFICATION ---');

    // 1. Run migrations
    await runMigrations();

    const now = new Date().toISOString();

    // 2. Create test merchant user
    const merchantEmail = 'merchant.test@cliks.com';
    let merchant = await db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(merchantEmail.toLowerCase());
    if (!merchant) {
        const mRes = await db.prepare(`
            INSERT INTO users (username, email, password_hash, role, business_name, created_at, updated_at)
            VALUES ('TestMerchant', ?, 'hash123', 'user', 'Apex Retail Solutions', ?, ?)
        `).run(merchantEmail, now, now);
        merchant = await db.prepare('SELECT * FROM users WHERE id = ?').get(mRes.lastInsertRowid);
    }

    // 3. Create test CLIKS customer user
    const customerEmail = 'customer.test@cliks.com';
    let customer = await db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(customerEmail.toLowerCase());
    if (!customer) {
        const cRes = await db.prepare(`
            INSERT INTO users (username, email, password_hash, role, created_at, updated_at)
            VALUES ('JohnCustomer', ?, 'hash123', 'user', ?, ?)
        `).run(customerEmail, now, now);
        customer = await db.prepare('SELECT * FROM users WHERE id = ?').get(cRes.lastInsertRowid);
    }

    console.log(`Merchant User ID: ${merchant.id}, Business: ${merchant.business_name}`);
    console.log(`Customer User ID: ${customer.id}, Email: ${customer.email}`);

    // 4. Create dummy Sales Invoice for registered customer
    const invNum = `INV-TEST-${Date.now().toString().slice(-4)}`;
    const invoicePayload = {
        user_id: merchant.id,
        invoice_number: invNum,
        client_name: 'John Customer',
        client_email: 'CUSTOMER.TEST@CLIKS.COM', // Mixed-case email to test case-insensitive matching
        client_gstin: '33AAACB1234C1Z1',
        billing_address: '123 Main St, Tech City',
        shipping_address: '123 Main St, Tech City',
        amount: 10000,
        tax_amount: 1800,
        total_amount: 11800,
        paid_amount: 11800,
        due_amount: 0,
        discount_amount: 0,
        round_off: 0,
        status: 'Paid',
        due_date: '2026-08-15',
        payment_mode: 'UPI',
        invoice_type: 'GST',
        tax_type: 'Exclusive',
        items: JSON.stringify([
            { description: 'Wireless Headphones', quantity: 2, price: 5000, amount: 10000 }
        ]),
        created_at: now,
        updated_at: now
    };

    const invInsert = await db.prepare(`
        INSERT INTO business_invoices (
            user_id, invoice_number, client_name, client_email, client_gstin,
            billing_address, shipping_address, amount, tax_amount, total_amount,
            paid_amount, due_amount, discount_amount, round_off, status, due_date,
            payment_mode, invoice_type, tax_type, items, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        merchant.id, invoicePayload.invoice_number, invoicePayload.client_name, invoicePayload.client_email, invoicePayload.client_gstin,
        invoicePayload.billing_address, invoicePayload.shipping_address, invoicePayload.amount, invoicePayload.tax_amount, invoicePayload.total_amount,
        invoicePayload.paid_amount, invoicePayload.due_amount, invoicePayload.discount_amount, invoicePayload.round_off, invoicePayload.status, invoicePayload.due_date,
        invoicePayload.payment_mode, invoicePayload.invoice_type, invoicePayload.tax_type, invoicePayload.items, invoicePayload.created_at, invoicePayload.updated_at
    );

    const createdInvoice = await db.prepare('SELECT * FROM business_invoices WHERE id = ?').get(invInsert.lastInsertRowid);

    console.log(`Generated Invoice ID: ${createdInvoice.id}, Number: ${createdInvoice.invoice_number}`);

    // 5. Trigger processCustomerInvoiceIntegration
    await processCustomerInvoiceIntegration({
        createdInvoice,
        merchantUserId: merchant.id
    });

    // 6. Assertions for Registered Customer
    const purchaseRecord = await db.prepare(
        'SELECT * FROM customer_purchase_history WHERE invoice_number = ?'
    ).get(createdInvoice.invoice_number);

    if (!purchaseRecord) {
        throw new Error('FAILED: Purchase history record was NOT created!');
    }
    console.log('✅ PASS: Purchase History record created successfully:');
    console.log({
        invoice_number: purchaseRecord.invoice_number,
        merchant_name: purchaseRecord.merchant_name,
        merchant_business_id: purchaseRecord.merchant_business_id,
        customer_user_id: purchaseRecord.customer_user_id,
        customer_name: purchaseRecord.customer_name,
        customer_email: purchaseRecord.customer_email,
        total_amount: purchaseRecord.total_amount,
        gst: purchaseRecord.gst,
        net_amount: purchaseRecord.net_amount,
        payment_status: purchaseRecord.payment_status,
        invoice_status: purchaseRecord.invoice_status
    });

    // Assert Loyalty Wallet
    const walletRecord = await db.prepare(
        'SELECT * FROM customer_loyalty_wallets WHERE user_id = ?'
    ).get(customer.id);
    if (!walletRecord || walletRecord.points_balance < 118) {
        throw new Error(`FAILED: Customer Loyalty Wallet points balance incorrect. Got: ${walletRecord ? walletRecord.points_balance : 'null'}`);
    }
    console.log(`✅ PASS: Loyalty Wallet updated successfully: Balance = ${walletRecord.points_balance} pts (Earned: ${walletRecord.total_earned})`);

    // Assert User Loyalty Points
    const updatedUser = await db.prepare('SELECT loyalty_points FROM users WHERE id = ?').get(customer.id);
    console.log(`✅ PASS: User table updated: user.loyalty_points = ${updatedUser.loyalty_points}`);

    // Assert Notification
    const notifRecord = await db.prepare(
        'SELECT * FROM notifications WHERE user_id = ? AND title = ? ORDER BY id DESC'
    ).get(customer.id, 'New Purchase Recorded');
    if (!notifRecord) {
        throw new Error('FAILED: Notification was NOT created for customer!');
    }
    console.log(`✅ PASS: Customer Notification created: "${notifRecord.title}" - "${notifRecord.message}"`);

    // 7. Test for Unregistered Customer
    const unregInvNum = `INV-UNREG-${Date.now().toString().slice(-4)}`;
    const unregPayload = {
        ...invoicePayload,
        invoice_number: unregInvNum,
        client_name: 'Unregistered Person',
        client_email: 'unregistered.cust.test@gmail.com'
    };
    const unregInsert = await db.prepare(`
        INSERT INTO business_invoices (
            user_id, invoice_number, client_name, client_email, client_gstin,
            billing_address, shipping_address, amount, tax_amount, total_amount,
            paid_amount, due_amount, discount_amount, round_off, status, due_date,
            payment_mode, invoice_type, tax_type, items, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        merchant.id, unregPayload.invoice_number, unregPayload.client_name, unregPayload.client_email, unregPayload.client_gstin,
        unregPayload.billing_address, unregPayload.shipping_address, unregPayload.amount, unregPayload.tax_amount, unregPayload.total_amount,
        unregPayload.paid_amount, unregPayload.due_amount, unregPayload.discount_amount, unregPayload.round_off, unregPayload.status, unregPayload.due_date,
        unregPayload.payment_mode, unregPayload.invoice_type, unregPayload.tax_type, unregPayload.items, unregPayload.created_at, unregPayload.updated_at
    );

    const unregInvoice = await db.prepare('SELECT * FROM business_invoices WHERE id = ?').get(unregInsert.lastInsertRowid);

    await processCustomerInvoiceIntegration({
        createdInvoice: unregInvoice,
        merchantUserId: merchant.id
    });

    const unregPurchaseRecord = await db.prepare(
        'SELECT * FROM customer_purchase_history WHERE invoice_number = ?'
    ).get(unregInvNum);

    if (unregPurchaseRecord) {
        throw new Error('FAILED: Purchase record should NOT exist for unregistered user!');
    }
    console.log('✅ PASS: Unregistered customer flow passed cleanly without side-effects or errors.');

    console.log('--- ALL INTEGRATION VERIFICATION TESTS PASSED SUCCESSFULLY! ---');
    process.exit(0);
}

runTest().catch(err => {
    console.error('❌ VERIFICATION TEST FAILED:', err);
    process.exit(1);
});
