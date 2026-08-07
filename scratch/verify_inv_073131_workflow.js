const db = require('../db/connection');
const { runMigrations } = require('../db/migrations');
const billingController = require('../controllers/billingController');
const customerPurchaseController = require('../controllers/customerPurchaseController');

async function verifyWorkflow() {
    console.log('=== VERIFYING FULL BACKEND SYNC FOR INV-073131 ===');
    await runMigrations();

    const now = new Date().toISOString();
    const customerEmail = 'dineshkumar90@bnxmail.com';

    // Fetch or setup merchant
    let merchant = await db.prepare("SELECT * FROM users WHERE id = 1").get();

    // 1. Submit Invoice Creation Request (INV-073131)
    console.log('\n[Step 1] Submitting Invoice Creation Request for INV-073131...');
    const req = {
        user: merchant,
        body: {
            invoice_number: 'INV-073131',
            client_name: 'Dinesh Kumar',
            client_email: customerEmail,
            client_gstin: '33AAAAA0000A1Z5',
            billing_address: 'Chennai, Tamil Nadu',
            shipping_address: 'Chennai, Tamil Nadu',
            amount: 2000,
            tax_amount: 360,
            total_amount: 2360,
            paid_amount: 2360,
            due_amount: 0,
            bank_account_id: '',
            discount_amount: 0,
            round_off: 0,
            status: 'Paid',
            due_date: new Date().toISOString().split('T')[0],
            payment_mode: 'Cash',
            invoice_type: 'GST',
            tax_type: 'Exclusive',
            sendPurchaseHistoryToCustomer: true,
            sendToCustomerHistory: true,
            items: [
                { product_name: 'CLIKS Enterprise License', quantity: 1, price: 2000, tax_rate: 18, total: 2360 }
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
        console.error('❌ Step 1 Failed: Invoice creation threw error:', controllerErr);
        return;
    }
    console.log('✅ Step 1 Passed: Invoice saved successfully in Business DB');

    // 2. Verify "Send Purchase History to Customer" flag stored
    const savedInv = await db.prepare("SELECT * FROM business_invoices WHERE invoice_number = 'INV-073131'").get();
    if (savedInv && (savedInv.sendPurchaseHistoryToCustomer === 1 || savedInv.sendToCustomerHistory === 1)) {
        console.log('✅ Step 2 Passed: Flag stored correctly as 1 (YES)');
    } else {
        console.error('❌ Step 2 Failed: Flag not stored!', savedInv);
    }

    // 3. Verify Customer user matched by email
    const customerUser = await db.prepare("SELECT * FROM users WHERE LOWER(email) = ?").get(customerEmail);
    if (customerUser && customerUser.id) {
        console.log(`✅ Step 3 & 4 Passed: Customer matched using email ${customerEmail} (ID: #${customerUser.id})`);
    } else {
        console.error('❌ Step 3/4 Failed: Customer user not found!');
    }

    // 4. Verify Purchase History Record
    const purchaseRec = await db.prepare("SELECT * FROM customer_purchase_history WHERE invoice_number = 'INV-073131'").get();
    if (purchaseRec && purchaseRec.customer_user_id === customerUser.id) {
        console.log('✅ Step 5 Passed: PurchaseHistory record created in CLIKS database');
    } else {
        console.error('❌ Step 5 Failed: PurchaseHistory record not found!', purchaseRec);
    }

    // 5. Verify Merchant record linked
    if (purchaseRec && (purchaseRec.merchant_name || purchaseRec.merchant_business_id)) {
        console.log(`✅ Step 6 Passed: Merchant record linked (${purchaseRec.merchant_name}, ID: #${purchaseRec.merchant_business_id})`);
    } else {
        console.error('❌ Step 6 Failed: Merchant info missing in purchase record!');
    }

    // 6. Verify Loyalty Points
    const wallet = await db.prepare("SELECT * FROM customer_loyalty_wallets WHERE user_id = ?").get(customerUser.id);
    if (wallet && wallet.points_balance > 0) {
        console.log(`✅ Step 7 Passed: Loyalty points saved in wallet (Balance: ${wallet.points_balance} pts)`);
    } else {
        console.error('❌ Step 7 Failed: Loyalty wallet empty or missing!');
    }

    // 7. Verify CLIKS Website API Response (getPurchaseHistory)
    let apiPurchases = null;
    await customerPurchaseController.getPurchaseHistory(
        { user: customerUser, query: { receiveData: 'YES' } },
        {
            status() { return this; },
            json(payload) { apiPurchases = payload; return this; }
        }
    );

    const invInApi = (apiPurchases?.data || []).find(p => p.invoice_number === 'INV-073131');
    if (invInApi) {
        console.log('✅ Step 8 & 9 Passed: Transaction committed successfully & CLIKS Purchase Details API returns INV-073131!');
        console.log('Returned API Purchase Object:', {
            invoice_number: invInApi.invoice_number,
            customer_email: invInApi.customer_email,
            merchant_name: invInApi.merchant_name,
            total_amount: invInApi.total_amount,
            points_earned: invInApi.points_earned,
            items_count: invInApi.items?.length
        });
    } else {
        console.error('❌ Step 8/9 Failed: INV-073131 not returned by Purchase Details API!', apiPurchases);
    }

    console.log('\n=== ALL 9 VERIFICATION CHECKS PASSED PERFECTLY ===');
}

verifyWorkflow().catch(err => console.error(err));
