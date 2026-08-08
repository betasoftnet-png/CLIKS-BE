const db = require('../db/connection');
const axios = require('axios');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'change_me_to_a_long_random_secret_32chars+';
const BASE_URL = 'http://localhost:3000/api/v1';

async function verifyLiveOpenModalSync() {
    console.log("==================================================================");
    console.log("   LIVE END-TO-END VERIFICATION: OPEN MODAL REALTIME SYNC");
    console.log("==================================================================");

    const email = 'santhosh2004@bnxmail.com';
    const now = new Date().toISOString();

    // 1. Get Website user (user ID: 23)
    const user = await db.prepare("SELECT * FROM users WHERE LOWER(email) = ?").get(email);
    if (!user) throw new Error("User santhosh2004@bnxmail.com not found!");
    const customerToken = jwt.sign({ id: user.id, email: user.email, username: user.username, role: 'user' }, JWT_SECRET);

    // 2. Fetch baseline purchases
    const baseRes = await axios.get(`${BASE_URL}/finance-plus/purchases`, {
        headers: { Authorization: `Bearer ${customerToken}` }
    });
    const basePurchases = baseRes.data?.data || baseRes.data || [];
    console.log(`Baseline Purchase Count for ${email}: ${basePurchases.length}`);

    // Simulate frontend grouping
    let groupedPurchases = {};
    basePurchases.forEach(p => {
        const id = p.merchant_business_id || p.merchant_name || 'unknown';
        if (!groupedPurchases[id]) {
            groupedPurchases[id] = { id, merchant_name: p.merchant_name, invoices: [] };
        }
        groupedPurchases[id].invoices.push(p);
    });

    let activeSelectedBusiness = groupedPurchases['7'] || Object.values(groupedPurchases)[0];
    console.log(`Opened History Modal for Merchant: ${activeSelectedBusiness.merchant_name} (Active Invoice Count: ${activeSelectedBusiness.invoices.length})`);

    // 3. Generate NEW Invoice #1 while History Modal is OPEN
    const merchantToken = jwt.sign({ id: 7, email: 'sanjay123@bnxmail.com', username: 'sanjay123', role: 'business' }, JWT_SECRET);
    const inv1 = `INV-OPENMODAL-${Date.now().toString().slice(-4)}`;

    console.log(`\nGenerating Fresh Invoice #${inv1} while History Modal is OPEN...`);
    const inv1Res = await axios.post(`${BASE_URL}/billing/invoices`, {
        invoice_number: inv1,
        client_name: 'gopi',
        client_email: email,
        amount: 4200,
        total_amount: 4200,
        paid_amount: 4200,
        due_amount: 0,
        status: 'Paid',
        payment_mode: 'UPI',
        invoice_type: 'GST',
        items: JSON.stringify([{ description: 'Open Modal Realtime Item', quantity: 1, price: 4200, tax_rate: 0, total: 4200 }])
    }, { headers: { Authorization: `Bearer ${merchantToken}` } });

    console.log(`Invoice Creation Status: ${inv1Res.status}`);

    // Verify Business DB
    const busDbRow = await db.prepare("SELECT * FROM business_invoices WHERE invoice_number = ?").get(inv1);
    if (!busDbRow) throw new Error(`FAILED: Invoice ${inv1} not saved in business_invoices DB!`);
    console.log(`✅ Business DB Verified: ID #${busDbRow.id}, Amount = ₹${busDbRow.total_amount}`);

    // Verify customer_purchase_history DB
    const syncDbRow = await db.prepare("SELECT * FROM customer_purchase_history WHERE invoice_number = ?").get(inv1);
    if (!syncDbRow) throw new Error(`FAILED: Invoice ${inv1} not inserted into customer_purchase_history DB!`);
    console.log(`✅ customer_purchase_history DB Verified: ID #${syncDbRow.id}, Net Amount = ₹${syncDbRow.net_amount}`);

    // 4. Simulate 3-second background polling cycle
    const pollRes = await axios.get(`${BASE_URL}/finance-plus/purchases`, {
        headers: { Authorization: `Bearer ${customerToken}` }
    });
    const updatedPurchases = pollRes.data?.data || pollRes.data || [];
    console.log(`Updated Purchase Count via API: ${updatedPurchases.length}`);

    // Re-group and verify open History Modal auto-update logic
    const newGroups = {};
    updatedPurchases.forEach(p => {
        const id = p.merchant_business_id || p.merchant_name || 'unknown';
        if (!newGroups[id]) {
            newGroups[id] = { id, merchant_name: p.merchant_name, invoices: [] };
        }
        newGroups[id].invoices.push(p);
    });

    const updatedSelectedBusiness = newGroups[activeSelectedBusiness.id] || newGroups['7'];
    if (!updatedSelectedBusiness) throw new Error("Merchant group disappeared during update!");

    console.log(`\nSimulating PurchaseDetails useEffect sync for open History Modal:`);
    console.log(`Previous Modal Invoices Count: ${activeSelectedBusiness.invoices.length}`);
    console.log(`Updated Modal Invoices Count: ${updatedSelectedBusiness.invoices.length}`);

    const hasNewInvoice = updatedSelectedBusiness.invoices.some(i => i.invoice_number === inv1);
    if (!hasNewInvoice) throw new Error(`FAILED: Invoice ${inv1} not found in open History modal!`);

    console.log(`✅ Live History Modal Realtime Update Verified: Fresh invoice #${inv1} is VISIBLE inside the open History Modal!`);

    // 5. Test Rejected Connection Protection
    console.log(`\n--- Testing Rejected Connection Authorization Protection ---`);
    const rejEmail = 'reject_test@bnxmail.com';
    const rejInv = `INV-REJ-SAFE-${Date.now().toString().slice(-4)}`;
    const rejRes = await axios.post(`${BASE_URL}/billing/invoices`, {
        invoice_number: rejInv,
        client_name: 'Reject Customer',
        client_email: rejEmail,
        amount: 999,
        total_amount: 999,
        paid_amount: 999,
        due_amount: 0,
        status: 'Paid',
        payment_mode: 'Cash',
        invoice_type: 'GST',
        items: JSON.stringify([{ description: 'Blocked Product', quantity: 1, price: 999, tax_rate: 0, total: 999 }])
    }, { headers: { Authorization: `Bearer ${merchantToken}` } });

    console.log(`Rejected Invoice Creation Status: ${rejRes.status}`);
    const rejHist = await db.prepare("SELECT * FROM customer_purchase_history WHERE invoice_number = ?").get(rejInv);
    console.log(`Rejected Customer DB Sync Record: ${rejHist ? 'UNEXPECTED INSERTION' : 'NONE (CORRECTLY BLOCKED)'}`);
    if (rejHist) throw new Error("SECURITY FAILURE: Invoice for rejected connection was synchronized!");
    console.log("✅ Security Verified: Invoices for rejected/unconnected customers are strictly BLOCKED from synchronizing!");

    console.log("\n==================================================================");
    console.log("   ALL TEST CASES PASSED WITH 100% SUCCESS!");
    console.log("==================================================================");
}

verifyLiveOpenModalSync().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
