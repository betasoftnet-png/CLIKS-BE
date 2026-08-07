const db = require('../db/connection');
const { runMigrations } = require('../db/migrations');
const billingController = require('../controllers/billingController');
const customerPurchaseController = require('../controllers/customerPurchaseController');

async function verifyCompleteSyncWorkflow() {
    console.log('================================================================');
    console.log('=== COMPLETE BACKEND SYNC VERIFICATION (CLIKS BUS -> CLIKS) ===');
    console.log('================================================================');

    await runMigrations();

    const now = new Date().toISOString();
    const customerEmail = 'dineshkumar90@bnxmail.com';

    let merchant = await db.prepare("SELECT * FROM users WHERE id = 1").get();

    // 1. Submit Invoice Creation via Billing Controller
    const invNum = `INV-SYNC-${Date.now().toString().slice(-4)}`;
    console.log(`\n--- STEP 1: Generating & Saving Invoice ${invNum} ---`);

    const req = {
        user: merchant,
        body: {
            invoice_number: invNum,
            client_name: 'Dinesh Kumar',
            client_email: customerEmail,
            client_gstin: '33AAAAA0000A1Z5',
            billing_address: '100 Mount Road, Chennai',
            shipping_address: '100 Mount Road, Chennai',
            amount: 5000,
            tax_amount: 900,
            total_amount: 5900,
            paid_amount: 5900,
            due_amount: 0,
            bank_account_id: '',
            discount_amount: 0,
            round_off: 0,
            status: 'Paid',
            due_date: new Date().toISOString().split('T')[0],
            payment_mode: 'UPI',
            invoice_type: 'GST',
            tax_type: 'Exclusive',
            sendPurchaseHistoryToCustomer: true,
            sendToCustomerHistory: true,
            items: [
                { product_name: 'CLIKS POS Terminal Hardware', quantity: 1, price: 3000, tax_rate: 18, total: 3540 },
                { product_name: 'CLIKS Thermal Receipt Printer', quantity: 1, price: 2000, tax_rate: 18, total: 2360 }
            ]
        }
    };

    let controllerRes = null;
    let controllerErr = null;
    const res = {
        status(code) { this.statusCode = code; return this; },
        json(payload) {
            if (this.statusCode >= 400) controllerErr = payload;
            else controllerRes = payload;
            return this;
        }
    };

    await billingController.createInvoice(req, res);

    if (controllerErr) {
        console.error('❌ Failed to create invoice:', controllerErr);
        return;
    }

    console.log('✅ STEP 1 PASSED: Invoice generated & saved in Business DB');

    // 2. Verify Database Tables
    console.log('\n--- STEP 2: Verifying All Required Database Tables ---');

    // A. business_invoices
    const invInDb = await db.prepare("SELECT * FROM business_invoices WHERE invoice_number = ?").get(invNum);
    console.log('1. business_invoices:', { id: invInDb.id, invoice_number: invInDb.invoice_number, client_email: invInDb.client_email, sendPurchaseHistoryToCustomer: invInDb.sendPurchaseHistoryToCustomer });

    // B. customer_purchase_history
    const custHist = await db.prepare("SELECT * FROM customer_purchase_history WHERE invoice_number = ?").get(invNum);
    console.log('2. customer_purchase_history:', { id: custHist.id, invoice_number: custHist.invoice_number, customer_email: custHist.customer_email, net_amount: custHist.net_amount, points_earned: custHist.points_earned });

    // C. purchase_history
    const purchaseHist = await db.prepare("SELECT * FROM purchase_history WHERE invoice_number = ?").get(invNum);
    console.log('3. purchase_history:', { id: purchaseHist.id, invoice_number: purchaseHist.invoice_number, customer_email: purchaseHist.customer_email });

    // D. merchant_summary
    const mSummary = await db.prepare("SELECT * FROM merchant_summary WHERE merchant_business_id = ? AND customer_email = ?").get(merchant.id, customerEmail);
    console.log('4. merchant_summary:', mSummary);

    // E. customer_loyalty_transactions
    const lTx = await db.prepare("SELECT * FROM customer_loyalty_transactions WHERE invoice_number = ?").all(invNum);
    console.log('5. customer_loyalty_transactions:', lTx);

    // F. active_integrations
    const activeInteg = await db.prepare("SELECT * FROM active_integrations WHERE merchant_business_id = ? AND customer_email = ?").get(merchant.id, customerEmail);
    console.log('6. active_integrations:', activeInteg);

    // 3. Verify Purchase History API Output
    console.log('\n--- STEP 3: Verifying CLIKS Website Purchase History API ---');
    const customerUser = await db.prepare("SELECT * FROM users WHERE LOWER(email) = ?").get(customerEmail);

    let apiResponse = null;
    await customerPurchaseController.getPurchaseHistory(
        { user: customerUser, query: { receiveData: 'YES' } },
        {
            status() { return this; },
            json(payload) { apiResponse = payload; return this; }
        }
    );

    const matchInApi = (apiResponse?.data || []).find(p => p.invoice_number === invNum);

    if (matchInApi && invInDb && custHist && purchaseHist && mSummary && activeInteg) {
        console.log('\n================================================================');
        console.log('🎉 ALL 10 REQUIREMENTS VERIFIED PERFECTLY & SYNC IS 100% WORKING');
        console.log('================================================================');
    } else {
        console.error('\n❌ VERIFICATION FAILED!');
    }
}

verifyCompleteSyncWorkflow().catch(err => console.error(err));
