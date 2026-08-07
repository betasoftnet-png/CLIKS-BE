const db = require('../db/connection');
const { runMigrations } = require('../db/migrations');
const billingController = require('../controllers/billingController');
const customerPurchaseController = require('../controllers/customerPurchaseController');

async function testApiCreate() {
    console.log('=== SIMULATING HTTP API CREATE INVOICE INV-073131 ===');
    await runMigrations();

    let merchant = await db.prepare("SELECT * FROM users WHERE id = 1").get();

    const req = {
        user: merchant,
        body: {
            invoice_number: 'INV-073131',
            client_name: 'Dinesh Kumar',
            client_email: 'dineshkumar90@bnxmail.com',
            client_gstin: '',
            billing_address: '123 Main Street',
            shipping_address: '123 Main Street',
            amount: 1000,
            tax_amount: 180,
            total_amount: 1180,
            paid_amount: 1180,
            due_amount: 0,
            bank_account_id: '',
            discount_amount: 0,
            round_off: 0,
            status: 'Paid',
            due_date: '2026-08-07',
            payment_mode: 'Cash',
            invoice_type: 'GST',
            tax_type: 'Exclusive',
            sendPurchaseHistoryToCustomer: true,
            sendToCustomerHistory: true,
            items: [
                { product_name: 'Test Product A', quantity: 1, price: 1000, tax_rate: 18, total: 1180 }
            ]
        }
    };

    let apiResult = null;
    let apiError = null;

    const res = {
        status(code) { this.statusCode = code; return this; },
        json(payload) {
            if (this.statusCode && this.statusCode >= 400) {
                apiError = payload;
            } else {
                apiResult = payload;
            }
            return this;
        }
    };

    try {
        await billingController.createInvoice(req, res);
    } catch (err) {
        console.error('Unhandled Controller Exception:', err);
    }

    console.log('\n--- API CREATE RESULT ---');
    console.log('Error:', apiError);
    console.log('Result:', apiResult);

    // Verify in DB
    const inv = await db.prepare("SELECT * FROM business_invoices WHERE invoice_number = 'INV-073131'").get();
    console.log('\n--- INVOICE IN DB ---');
    console.log(inv);

    const purchaseHist = await db.prepare("SELECT * FROM customer_purchase_history WHERE invoice_number = 'INV-073131'").get();
    console.log('\n--- PURCHASE HISTORY IN DB ---');
    console.log(purchaseHist);

    // Verify Customer user
    const customerUser = await db.prepare("SELECT * FROM users WHERE LOWER(email) = 'dineshkumar90@bnxmail.com'").get();
    console.log('\n--- CUSTOMER USER IN DB ---');
    console.log(customerUser);

    // Verify Customer Purchase Details API
    let websiteDetails = null;
    await customerPurchaseController.getPurchaseHistory(
        { user: customerUser, query: { receiveData: 'YES' } },
        {
            status() { return this; },
            json(payload) { websiteDetails = payload; return this; }
        }
    );
    console.log('\n--- CLIKS WEBSITE PURCHASE DETAILS API ---');
    console.log(websiteDetails);
}

testApiCreate().catch(err => console.error(err));
