const db = require('../db/connection');
const { runMigrations } = require('../db/migrations');
const { processCustomerInvoiceIntegration } = require('../utils/customerIntegration');

async function runVerification() {
    console.log('--- STARTING COMPLETE PURCHASE HISTORY SYNC VERIFICATION ---');
    await runMigrations();

    const now = new Date().toISOString();
    const customerEmail = 'santhosh2004@bnxmail.com';

    // 1. Ensure merchant and customer user accounts exist
    let merchant = await db.prepare('SELECT * FROM users WHERE id = 1').get();
    if (!merchant) {
        const mRes = await db.prepare(`
            INSERT INTO users (username, email, password_hash, role, business_name, created_at, updated_at)
            VALUES ('sanjay123', 'merchant.complete@cliks.com', 'hash123', 'user', 'Sanjay Enterprises', ?, ?)
        `).run(now, now);
        merchant = await db.prepare('SELECT * FROM users WHERE id = ?').get(mRes.lastInsertRowid);
    }

    let customer = await db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(customerEmail);
    if (!customer) {
        const cRes = await db.prepare(`
            INSERT INTO users (username, email, password_hash, role, loyalty_points, created_at, updated_at)
            VALUES ('santhosh2004', ?, 'hash123', 'user', 500, ?, ?)
        `).run(customerEmail, now, now);
        customer = await db.prepare('SELECT * FROM users WHERE id = ?').get(cRes.lastInsertRowid);
    }

    // 2. Create invoice with complete fields: Customer, Business, Invoice, Purchased Products, Payment, Summary, Loyalty
    const invNum = `INV-FULL-${Date.now().toString().slice(-4)}`;
    const invoicePayload = {
        user_id: merchant.id,
        invoice_number: invNum,
        invoice_type: 'GST',
        client_name: 'santhosh',
        client_email: customerEmail,
        client_gstin: '33AAAAA0000A1Z5',
        shipping_address: '123 Tech Park, Anna Salai, Chennai',
        amount: 15470,
        tax_amount: 2784.6,
        discount_amount: 1530,
        round_off: 0.4,
        total_amount: 18255,
        paid_amount: 18255,
        due_amount: 0,
        status: 'Paid',
        due_date: '2026-08-15',
        payment_mode: 'UPI',
        upi_id: 'santhosh@ybl',
        bank_account_id: '',
        redeemed_points: 100,
        items: JSON.stringify([
            {
                product_name: 'Vivo V29 Pro',
                description: 'Vivo 5G Smartphone 256GB',
                hsn_code: 'max-099',
                quantity: 1,
                unit: 'Pcs',
                price: 17000,
                discount_percent: 9,
                discount_amount: 1530,
                tax_rate: 18,
                tax_amount: 2784.6,
                total: 18254.6
            }
        ]),
        created_at: now,
        updated_at: now
    };

    const invInsert = await db.prepare(`
        INSERT INTO business_invoices (
            user_id, invoice_number, client_name, client_email, client_gstin,
            shipping_address, amount, tax_amount, total_amount, paid_amount,
            due_amount, discount_amount, round_off, status, due_date,
            payment_mode, invoice_type, items, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        merchant.id, invoicePayload.invoice_number, invoicePayload.client_name, invoicePayload.client_email, invoicePayload.client_gstin,
        invoicePayload.shipping_address, invoicePayload.amount, invoicePayload.tax_amount, invoicePayload.total_amount, invoicePayload.paid_amount,
        invoicePayload.due_amount, invoicePayload.discount_amount, invoicePayload.round_off, invoicePayload.status, invoicePayload.due_date,
        invoicePayload.payment_mode, invoicePayload.invoice_type, invoicePayload.items, invoicePayload.created_at, invoicePayload.updated_at
    );

    const createdInvoice = await db.prepare('SELECT * FROM business_invoices WHERE id = ?').get(invInsert.lastInsertRowid);
    createdInvoice.upi_id = 'santhosh@ybl';
    createdInvoice.redeemed_points = 100;

    // Trigger processCustomerInvoiceIntegration
    await processCustomerInvoiceIntegration({
        createdInvoice,
        merchantUserId: merchant.id
    });

    // 3. Query customer_purchase_history and verify ALL fields saved
    const record = await db.prepare('SELECT * FROM customer_purchase_history WHERE invoice_number = ?').get(invNum);

    if (!record) {
        throw new Error('FAILED: Purchase history record not found!');
    }

    console.log('--- VERIFYING SAVED PURCHASE HISTORY RECORD ---');
    console.log('Customer Name:', record.customer_name);
    console.log('Customer Email:', record.customer_email);
    console.log('Customer GSTIN:', record.customer_gstin);
    console.log('Shipping Address:', record.shipping_address);
    console.log('Merchant ID:', record.merchant_business_id);
    console.log('Merchant Name:', record.merchant_name);
    console.log('Invoice Number:', record.invoice_number);
    console.log('Invoice Type:', record.invoice_type);
    console.log('Payment Mode:', record.payment_mode);
    console.log('UPI ID:', record.upi_id);
    console.log('Subtotal:', record.subtotal);
    console.log('Discount:', record.discount);
    console.log('GST:', record.gst);
    console.log('Round Off:', record.round_off);
    console.log('Net Amount:', record.net_amount);
    console.log('Paid Amount:', record.paid_amount);
    console.log('Points Earned:', record.points_earned);
    console.log('Points Redeemed:', record.points_redeemed);
    console.log('Net Points Added:', record.net_points_added);

    const items = JSON.parse(record.items);
    console.log('Purchased Products:', items);

    // Assertions
    if (record.customer_email !== customerEmail) throw new Error('Customer email mismatch');
    if (record.customer_gstin !== '33AAAAA0000A1Z5') throw new Error('Customer GSTIN mismatch');
    if (record.shipping_address !== '123 Tech Park, Anna Salai, Chennai') throw new Error('Shipping address mismatch');
    if (record.payment_mode !== 'UPI') throw new Error('Payment mode mismatch');
    if (record.upi_id !== 'santhosh@ybl') throw new Error('UPI ID mismatch');
    if (record.points_earned !== 182) throw new Error('Points earned mismatch');
    if (record.points_redeemed !== 100) throw new Error('Points redeemed mismatch');
    if (record.net_points_added !== 82) throw new Error('Net points added mismatch');
    if (items.length !== 1 || items[0].product_name !== 'Vivo V29 Pro' || items[0].sku_hsn !== 'max-099') throw new Error('Product items mismatch');

    // Duplicate Prevention Verification
    await processCustomerInvoiceIntegration({
        createdInvoice,
        merchantUserId: merchant.id
    });
    const dupCheck = await db.prepare('SELECT count(*) as cnt FROM customer_purchase_history WHERE invoice_number = ?').get(invNum);
    if (dupCheck.cnt !== 1) throw new Error(`Duplicate invoices created! Count = ${dupCheck.cnt}`);
    console.log('✅ PASS: Duplicate prevention verified (Invoice count = 1)');

    console.log('--- ALL PURCHASE HISTORY SYNCHRONIZATION TESTS PASSED CLEANLY! ---');
    process.exit(0);
}

runVerification().catch(err => {
    console.error('❌ VERIFICATION FAILED:', err);
    process.exit(1);
});
