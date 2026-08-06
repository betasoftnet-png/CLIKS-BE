const db = require('../db/connection');
const { runMigrations } = require('../db/migrations');
const { processCustomerInvoiceIntegration } = require('../utils/customerIntegration');
const financePlusController = require('../controllers/financePlusController');

async function runTest() {
    console.log('--- TESTING FINANCE PLUS INVOICE RETRIEVAL API ---');
    await runMigrations();

    const now = new Date().toISOString();
    const customerEmail = 'santhosh2004@bnxmail.com';

    // 1. Ensure merchant and customer user accounts exist
    let merchant = await db.prepare('SELECT * FROM users WHERE id = 1').get();
    if (!merchant) {
        const mRes = await db.prepare(`
            INSERT INTO users (username, email, password_hash, role, business_name, created_at, updated_at)
            VALUES ('sanjay123', 'merchant.fp@cliks.com', 'hash123', 'user', 'Sanjay Supermarket', ?, ?)
        `).run(now, now);
        merchant = await db.prepare('SELECT * FROM users WHERE id = ?').get(mRes.lastInsertRowid);
    }

    let customer = await db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(customerEmail);
    if (!customer) {
        const cRes = await db.prepare(`
            INSERT INTO users (username, email, password_hash, role, loyalty_points, created_at, updated_at)
            VALUES ('santhosh2004', ?, 'hash123', 'user', 1878, ?, ?)
        `).run(customerEmail, now, now);
        customer = await db.prepare('SELECT * FROM users WHERE id = ?').get(cRes.lastInsertRowid);
    }

    // 2. Generate and save invoice into database
    const invNum = `INV-FP-${Date.now().toString().slice(-4)}`;
    const itemsArray = [
        {
            product_name: 'Samsung Galaxy S24 Ultra',
            description: 'Samsung Galaxy S24 Ultra 512GB Titanium Gray',
            hsn_code: '85171300',
            quantity: 1,
            unit: 'Pcs',
            price: 120000,
            discount_percent: 5,
            discount_amount: 6000,
            tax_rate: 18,
            tax_amount: 20520,
            total: 134520
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
        '456 MG Road, Bengaluru', 114000, 20520, 134520, 134520,
        0, 6000, 0, 'Paid', '2026-08-25',
        'UPI', 'GST', JSON.stringify(itemsArray), now, now
    );

    const invoiceId = invInsert.lastInsertRowid;
    console.log(`✅ Invoice generated and saved into business_invoices table. invoiceId = ${invoiceId}`);

    const createdInvoice = await db.prepare('SELECT * FROM business_invoices WHERE id = ?').get(invoiceId);
    createdInvoice.upi_id = 'santhosh@okaxis';
    createdInvoice.redeemed_points = 200;

    // Trigger processCustomerInvoiceIntegration (Sync to customer purchase history)
    await processCustomerInvoiceIntegration({
        createdInvoice,
        merchantUserId: merchant.id
    });

    // 3. Test GET /api/v1/finance-plus/invoice/:invoiceId using numeric invoiceId
    const mockRes = {
        statusCode: 200,
        responseData: null,
        status(c) { this.statusCode = c; return this; },
        json(d) { this.responseData = d; return this; }
    };
    const req = {
        params: { invoiceId: String(invoiceId) },
        user: { id: customer.id, email: customerEmail }
    };

    await financePlusController.getInvoiceById(req, mockRes);
    const data = mockRes.responseData?.data || mockRes.responseData;

    console.log('--- GET /api/v1/finance-plus/invoice/' + invoiceId + ' RESPONSE ---');
    console.log('HTTP Status:', mockRes.statusCode);
    console.log('Invoice ID (_id / invoiceId):', data?._id || data?.invoiceId);
    console.log('Invoice Number:', data?.invoiceNumber || data?.invoice_number);
    console.log('Merchant Name:', data?.merchantName || data?.merchant_name);
    console.log('Customer Name:', data?.customerName || data?.customer_name);
    console.log('Customer Email:', data?.customerEmail || data?.customer_email);
    console.log('Invoice Date:', data?.invoiceDate || data?.created_at);
    console.log('Payment Mode:', data?.paymentMode || data?.payment_mode);
    console.log('Payment Status:', data?.paymentStatus || data?.payment_status);
    console.log('Shipping Address:', data?.shippingAddress || data?.shipping_address);
    console.log('GST:', data?.gst || data?.tax_amount);
    console.log('Discount:', data?.discount || data?.discount_amount);
    console.log('Loyalty Points:', data?.loyaltyPoints || data?.points_earned);
    console.log('PDF URL:', data?.pdfUrl || data?.pdf_url);
    console.log('Purchased Items:', data?.items);

    // Verify assertions
    if (mockRes.statusCode !== 200) throw new Error(`FAILED: Expected HTTP status 200, got ${mockRes.statusCode}`);
    if (!data || (data.invoiceId !== invoiceId && data._id !== invoiceId)) throw new Error('FAILED: invoiceId mismatch!');
    if ((data.invoiceNumber || data.invoice_number) !== invNum) throw new Error('FAILED: Invoice number mismatch!');
    if (!data.items || data.items.length === 0) throw new Error('FAILED: Items array is empty!');
    if (data.items[0].product_name !== 'Samsung Galaxy S24 Ultra') throw new Error('FAILED: Product name mismatch!');

    // 4. Test searching by invoiceNumber as identifier
    const mockResByNum = {
        statusCode: 200,
        responseData: null,
        status(c) { this.statusCode = c; return this; },
        json(d) { this.responseData = d; return this; }
    };
    const reqByNum = {
        params: { invoiceId: invNum },
        user: { id: customer.id, email: customerEmail }
    };
    await financePlusController.getInvoiceById(reqByNum, mockResByNum);
    if (mockResByNum.statusCode !== 200) throw new Error('FAILED: Search by invoiceNumber failed!');
    console.log('✅ PASS: Search by invoiceNumber identifier succeeded');

    // 5. Test 404 logging for non-existent invoice identifier
    const mockRes404 = {
        statusCode: 200,
        responseData: null,
        status(c) { this.statusCode = c; return this; },
        json(d) { this.responseData = d; return this; }
    };
    const req404 = {
        params: { invoiceId: 'INVALID-99999' },
        user: { id: customer.id, email: customerEmail }
    };
    await financePlusController.getInvoiceById(req404, mockRes404);
    if (mockRes404.statusCode !== 404) throw new Error('FAILED: Non-existent invoice should return 404!');
    console.log('✅ PASS: 404 logged and returned cleanly for non-existent identifier');

    console.log('--- ALL FINANCE PLUS INVOICE RETRIEVAL TESTS PASSED SUCCESSFULLY! ---');
    process.exit(0);
}

runTest().catch(err => {
    console.error('❌ TEST FAILED:', err);
    process.exit(1);
});
