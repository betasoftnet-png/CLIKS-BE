const db = require('../db/connection');
const { runMigrations } = require('../db/migrations');
const { processCustomerInvoiceIntegration } = require('../utils/customerIntegration');
const customerPurchaseController = require('../controllers/customerPurchaseController');
const billingController = require('../controllers/billingController');

async function runVerification() {
    console.log('--- VERIFYING INVOICE PERSISTENCE & VIEW ITEMS INTEGRATION ---');
    await runMigrations();

    const now = new Date().toISOString();
    const customerEmail = 'santhosh2004@bnxmail.com';

    // 1. Ensure merchant and customer user accounts exist
    let merchant = await db.prepare('SELECT * FROM users WHERE id = 1').get();
    if (!merchant) {
        const mRes = await db.prepare(`
            INSERT INTO users (username, email, password_hash, role, business_name, created_at, updated_at)
            VALUES ('sanjay123', 'merchant.viewitems@cliks.com', 'hash123', 'user', 'Sanjay Tech Store', ?, ?)
        `).run(now, now);
        merchant = await db.prepare('SELECT * FROM users WHERE id = ?').get(mRes.lastInsertRowid);
    }

    let customer = await db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(customerEmail);
    if (!customer) {
        const cRes = await db.prepare(`
            INSERT INTO users (username, email, password_hash, role, loyalty_points, created_at, updated_at)
            VALUES ('santhosh2004', ?, 'hash123', 'user', 1000, ?, ?)
        `).run(customerEmail, now, now);
        customer = await db.prepare('SELECT * FROM users WHERE id = ?').get(cRes.lastInsertRowid);
    }

    // 2. Generate and save invoice into database (simulating Generate & Save Invoice click)
    const invNum = `INV-VIEW-${Date.now().toString().slice(-4)}`;
    const itemsArray = [
        {
            product_name: 'Vivo V29 Pro 5G',
            description: 'Vivo V29 Pro 5G Smartphone 256GB Velvet Red',
            hsn_code: '85171200',
            quantity: 2,
            unit: 'Pcs',
            price: 15000,
            discount_percent: 10,
            discount_amount: 3000,
            tax_rate: 18,
            tax_amount: 4860,
            total: 31860
        }
    ];

    const invInsert = await db.prepare(`
        INSERT INTO business_invoices (
            user_id, invoice_number, client_name, client_email, client_gstin,
            shipping_address, amount, tax_amount, total_amount, paid_amount,
            due_amount, discount_amount, round_off, status, due_date,
            payment_mode, invoice_type, items, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        merchant.id, invNum, 'santhosh', customerEmail, '33AAAAA0000A1Z5',
        '123 Anna Salai, Chennai', 27000, 4860, 31860, 31860,
        0, 3000, 0, 'Paid', '2026-08-20',
        'UPI', 'GST', JSON.stringify(itemsArray), now, now
    );

    const invoiceId = invInsert.lastInsertRowid;
    console.log(`✅ Step 1: Invoice saved into database. Primary Key (invoiceId) = ${invoiceId}`);

    const createdInvoice = await db.prepare('SELECT * FROM business_invoices WHERE id = ?').get(invoiceId);
    createdInvoice.upi_id = 'santhosh@okicici';
    createdInvoice.redeemed_points = 50;

    // Trigger processCustomerInvoiceIntegration (Sync & Item persistence)
    await processCustomerInvoiceIntegration({
        createdInvoice,
        merchantUserId: merchant.id
    });

    // 3. Requirement #7 Verification:
    // Criteria A: Invoice exists in database
    const dbInvoice = await db.prepare('SELECT * FROM business_invoices WHERE id = ?').get(invoiceId);
    if (!dbInvoice) throw new Error('FAILED: Invoice does not exist in business_invoices!');
    console.log('✅ Criteria A: Invoice exists in database (business_invoices)');

    // Criteria B: Invoice items exist in child table invoice_items
    const dbItems = await db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(invoiceId);
    if (!dbItems || dbItems.length === 0) throw new Error('FAILED: Invoice items do not exist in invoice_items table!');
    console.log(`✅ Criteria B: ${dbItems.length} invoice items exist in child table (invoice_items) for invoice_id = ${invoiceId}`);

    // Criteria C: invoiceId is valid
    if (!invoiceId || typeof invoiceId !== 'number') throw new Error('FAILED: invoiceId is invalid!');
    console.log(`✅ Criteria C: invoiceId is valid (${invoiceId})`);

    // Criteria D: Purchase Sync contains the same invoiceId
    const syncRecord = await db.prepare('SELECT * FROM customer_purchase_history WHERE invoice_number = ?').get(invNum);
    if (!syncRecord) throw new Error('FAILED: Purchase Sync record not found in customer_purchase_history!');
    if (syncRecord.invoice_id !== invoiceId) {
        throw new Error(`FAILED: Purchase Sync invoice_id (${syncRecord.invoice_id}) does not match invoiceId (${invoiceId})!`);
    }
    console.log(`✅ Criteria D: Purchase Sync contains matching invoice_id = ${syncRecord.invoice_id}`);

    // 4. Test Customer Application API response for "View Items" click (Requirement #8)
    const mockRes = {
        statusCode: 200,
        responseData: null,
        status(code) { this.statusCode = code; return this; },
        json(data) { this.responseData = data; return this; },
        send(data) { this.responseData = data; return this; }
    };
    const req = {
        params: { id: String(invoiceId) },
        user: { id: customer.id, email: customerEmail }
    };

    await customerPurchaseController.getPurchaseDetailsById(req, mockRes);
    const fetchedData = mockRes.responseData?.data || mockRes.responseData;

    console.log('--- SIMULATING CLIKS WEBSITE "VIEW ITEMS" API RESPONSE ---');
    console.log('Response Status:', mockRes.statusCode);
    console.log('Response Invoice ID:', fetchedData?.id || fetchedData?.invoiceId);
    console.log('Response Invoice Number:', fetchedData?.invoice_number);
    console.log('Response Merchant Name:', fetchedData?.merchant_name || fetchedData?.business_name);
    console.log('Response Items Count:', fetchedData?.items?.length);
    console.log('Response First Item:', fetchedData?.items ? fetchedData.items[0] : null);

    if (!fetchedData || !fetchedData.items || fetchedData.items.length === 0) {
        throw new Error('FAILED: CLIKS Website API failed to fetch invoice items!');
    }
    if (fetchedData.items[0].product_name !== 'Vivo V29 Pro 5G') {
        throw new Error('FAILED: Product name mismatch in View Items response!');
    }

    console.log('--- ALL INVOICE PERSISTENCE & VIEW ITEMS VERIFICATION TESTS PASSED SUCCESSFULLY! ---');
    process.exit(0);
}

runVerification().catch(err => {
    console.error('❌ VERIFICATION FAILED:', err);
    process.exit(1);
});
