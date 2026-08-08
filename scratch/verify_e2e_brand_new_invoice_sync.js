const db = require('../db/connection');
const axios = require('axios');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'change_me_to_a_long_random_secret_32chars+';
const BASE_URL = 'http://localhost:3000/api/v1';

async function verifyE2EBrandNewInvoiceSync() {
    console.log("==================================================================");
    console.log("   E2E BRAND-NEW SALES INVOICE SYNC & API RESPONSE VERIFICATION");
    console.log("==================================================================");

    const now = new Date();
    const invNum = `INV-BRANDNEW-${Date.now().toString().slice(-6)}`;
    const totalAmount = 18500;

    // 1. Fetch Merchant sanjay123 (ID: 7) and Website User tata123 (ID: 26)
    const merchant = await db.prepare("SELECT * FROM users WHERE LOWER(username) = 'sanjay123'").get();
    const websiteUser = await db.prepare("SELECT * FROM users WHERE LOWER(email) = 'tata123@bnxmail.com'").get();

    console.log(`1. Merchant User: ${merchant.username} (ID: ${merchant.id}, Email: ${merchant.email})`);
    console.log(`2. Customer User: ${websiteUser.username} (ID: ${websiteUser.id}, Email: ${websiteUser.email})`);

    // 2. Generate Tokens
    const merchantToken = jwt.sign({ id: merchant.id, email: merchant.email, username: merchant.username, role: 'business' }, JWT_SECRET);
    const customerToken = jwt.sign({ id: websiteUser.id, email: websiteUser.email, username: websiteUser.username, role: 'user' }, JWT_SECRET);

    // 3. Verify Connection Status in DB
    const conn = await db.prepare("SELECT status FROM customer_connections WHERE business_id = ? AND LOWER(customer_email) = ?")
        .get(merchant.id, websiteUser.email.toLowerCase());
    console.log(`3. Connection Status in DB: ${conn?.status}`);
    if (conn?.status !== 'accepted') throw new Error(`Expected connection status 'accepted', found '${conn?.status}'`);

    // 4. Create BRAND NEW Invoice via HTTP POST /api/v1/billing/invoices
    console.log(`\n4. Creating Brand-New Sales Invoice ${invNum} for ₹${totalAmount.toLocaleString()}...`);
    const createRes = await axios.post(`${BASE_URL}/billing/invoices`, {
        invoice_number: invNum,
        client_name: 'santhosh',
        client_email: websiteUser.email,
        amount: totalAmount,
        total_amount: totalAmount,
        paid_amount: totalAmount,
        due_amount: 0,
        status: 'Paid',
        payment_mode: 'UPI',
        invoice_type: 'GST',
        items: JSON.stringify([{ description: 'Brand New Verification Product', quantity: 1, price: totalAmount, tax_rate: 18, total: totalAmount }])
    }, {
        headers: { Authorization: `Bearer ${merchantToken}` }
    });

    console.log(`Create Invoice HTTP Status: ${createRes.status}`);
    if (createRes.status !== 201) throw new Error("Invoice creation HTTP status is not 201!");

    // 5. Verify DB Persistence in business_invoices
    const invInDb = await db.prepare("SELECT * FROM business_invoices WHERE invoice_number = ?").get(invNum);
    if (!invInDb) throw new Error(`Invoice ${invNum} was NOT saved in business_invoices table!`);
    console.log(`[BUSINESS DB] Invoice ${invInDb.invoice_number} saved (ID: ${invInDb.id}, Amount: ₹${invInDb.total_amount})`);

    // 6. Verify Customer Purchase History DB Table
    const syncInDb = await db.prepare("SELECT * FROM customer_purchase_history WHERE invoice_number = ?").get(invNum);
    if (!syncInDb) throw new Error(`Invoice ${invNum} was NOT synchronized into customer_purchase_history table!`);
    console.log(`[SYNC DB] Synced invoice ${syncInDb.invoice_number} (Merchant: ${syncInDb.merchant_name}, Total: ₹${syncInDb.total_amount}, Points: ${syncInDb.points_earned})`);

    // 7. Verify Loyalty Wallet
    const wallet = await db.prepare("SELECT * FROM customer_loyalty_wallets WHERE user_id = ?").get(websiteUser.id);
    console.log(`[LOYALTY WALLET] Points Balance: ${wallet?.points_balance || 0} pts`);

    // 8. Test Website Finance Plus Purchases API endpoint GET /api/v1/finance-plus/purchases
    console.log(`\n8. Testing Website Finance Plus Purchases API GET ${BASE_URL}/finance-plus/purchases...`);
    const apiRes = await axios.get(`${BASE_URL}/finance-plus/purchases`, {
        headers: { Authorization: `Bearer ${customerToken}` }
    });

    console.log(`API HTTP Status: ${apiRes.status}`);
    const purchases = apiRes.data?.data || apiRes.data || [];
    console.log(`Total Purchases Returned: ${purchases.length}`);

    const matchedPurch = purchases.find(p => p.invoice_number === invNum);
    if (!matchedPurch) throw new Error(`CRITICAL: Brand-New Invoice ${invNum} was NOT returned by Website Purchases API!`);

    console.log(`[SUCCESS] Brand-New Invoice ${invNum} successfully returned by Website API:`);
    console.log({
        invoice_number: matchedPurch.invoice_number,
        merchant_name: matchedPurch.merchant_name,
        customer_name: matchedPurch.customer_name,
        grand_total: matchedPurch.grand_total,
        points_earned: matchedPurch.points_earned,
        purchase_status: matchedPurch.purchase_status,
        timestamp: matchedPurch.timestamp
    });

    // 9. Verify 3-second Polling Deduplication (calling API again)
    const secondApiRes = await axios.get(`${BASE_URL}/finance-plus/purchases`, {
        headers: { Authorization: `Bearer ${customerToken}` }
    });
    const secondPurchases = secondApiRes.data?.data || secondApiRes.data || [];
    if (secondPurchases.length !== purchases.length) {
        throw new Error("Polling created duplicate records!");
    }
    console.log("\n[SUCCESS] Polling API re-fetch verified: zero duplicate records!");

    console.log("\n==================================================================");
    console.log("   E2E BRAND-NEW INVOICE SYNC & API VERIFICATION PASSED 100%!");
    console.log("==================================================================");
}

verifyE2EBrandNewInvoiceSync().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
