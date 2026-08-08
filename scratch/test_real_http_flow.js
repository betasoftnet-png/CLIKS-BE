const axios = require('axios');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'change_me_to_a_long_random_secret_32chars+';
const BASE_URL = 'http://localhost:3000/api/v1';

async function testRealHttpFlow() {
    console.log("==================================================================");
    console.log("   REAL HTTP NETWORK FLOW VERIFICATION (PORT 3000)");
    console.log("==================================================================");

    // 1. Generate JWT Token for Merchant sanjay123 (user ID: 7, role: 'business')
    const merchantPayload = { id: 7, email: 'sanjay123@bnxmail.com', username: 'sanjay123', role: 'business' };
    const merchantToken = jwt.sign(merchantPayload, JWT_SECRET, { expiresIn: '1h' });

    // 2. Generate JWT Token for Website Customer tata123 (user ID: 26, role: 'user')
    const customerPayload = { id: 26, email: 'tata123@bnxmail.com', username: 'tata123', role: 'user' };
    const customerToken = jwt.sign(customerPayload, JWT_SECRET, { expiresIn: '1h' });

    console.log("1. Merchant JWT Token generated:", merchantToken.slice(0, 20) + "...");
    console.log("2. Customer JWT Token generated:", customerToken.slice(0, 20) + "...");

    // 3. Send HTTP POST /api/v1/billing/invoices
    const invNum = `INV-REAL-HTTP-${Math.floor(1000 + Math.random() * 9000)}`;
    const invoicePayload = {
        invoice_number: invNum,
        client_name: 'santhosh',
        client_email: 'tata123@bnxmail.com',
        amount: 25000,
        total_amount: 25000,
        paid_amount: 25000,
        due_amount: 0,
        status: 'Paid',
        payment_mode: 'Cash',
        invoice_type: 'GST',
        items: JSON.stringify([{ description: 'Real HTTP Test Desk', quantity: 1, price: 25000, tax_rate: 18, total: 25000 }])
    };

    console.log(`\n3. Sending HTTP POST ${BASE_URL}/billing/invoices for ${invNum}...`);
    const createRes = await axios.post(`${BASE_URL}/billing/invoices`, invoicePayload, {
        headers: { Authorization: `Bearer ${merchantToken}` }
    });

    console.log(`HTTP Status: ${createRes.status}`);
    console.log("Backend Response:", createRes.data?.message, createRes.data?.data?.invoice_number);

    // 4. Send HTTP GET /api/v1/finance-plus/purchases
    console.log(`\n4. Sending HTTP GET ${BASE_URL}/finance-plus/purchases...`);
    const finPlusRes = await axios.get(`${BASE_URL}/finance-plus/purchases`, {
        headers: { Authorization: `Bearer ${customerToken}` }
    });

    console.log(`HTTP Status: ${finPlusRes.status}`);
    const purchases = finPlusRes.data?.data || finPlusRes.data || [];
    console.log(`Received Purchases Count: ${purchases.length}`);

    const matchedPurchase = purchases.find(p => p.invoice_number === invNum);
    console.log(`Is ${invNum} in Finance Plus API response?`, !!matchedPurchase);

    if (matchedPurchase) {
        console.log("Matched Purchase Data:", {
            invoice_number: matchedPurchase.invoice_number,
            merchant_name: matchedPurchase.merchant_name,
            customer_name: matchedPurchase.customer_name,
            grand_total: matchedPurchase.grand_total,
            points_earned: matchedPurchase.points_earned,
            purchase_status: matchedPurchase.purchase_status
        });
    } else {
        throw new Error(`FAILURE: ${invNum} was NOT found in Finance Plus API response!`);
    }

    // 5. Send HTTP GET /api/v1/customer/purchase-history
    console.log(`\n5. Sending HTTP GET ${BASE_URL}/customer/purchase-history...`);
    const custHistRes = await axios.get(`${BASE_URL}/customer/purchase-history`, {
        headers: { Authorization: `Bearer ${customerToken}` }
    });

    console.log(`HTTP Status: ${custHistRes.status}`);
    const custHist = custHistRes.data?.data || custHistRes.data || [];
    console.log(`Received Customer Purchase History Count: ${custHist.length}`);

    const matchedHist = custHist.find(p => p.invoice_number === invNum);
    console.log(`Is ${invNum} in Customer Purchase History API response?`, !!matchedHist);

    if (!matchedHist) {
        throw new Error(`FAILURE: ${invNum} was NOT found in Customer Purchase History API response!`);
    }

    console.log("\n==================================================================");
    console.log("   REAL HTTP NETWORK FLOW PASSED 100%!");
    console.log("==================================================================");
}

testRealHttpFlow().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
