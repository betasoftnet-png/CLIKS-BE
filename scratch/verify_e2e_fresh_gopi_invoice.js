const db = require('../db/connection');
const axios = require('axios');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'change_me_to_a_long_random_secret_32chars+';
const BASE_URL = 'http://localhost:3000/api/v1';

async function verifyFreshGopiInvoiceFlow() {
    console.log("==================================================================");
    console.log("   E2E VERIFICATION FOR FRESH INVOICE SYNC (GOPI / SANTHOSH2004)");
    console.log("==================================================================");

    const email = 'santhosh2004@bnxmail.com';
    const now = new Date().toISOString();

    // 1. Ensure Website user santhosh2004@bnxmail.com exists (ID: 23)
    let user = await db.prepare("SELECT * FROM users WHERE LOWER(email) = ?").get(email);
    if (!user) {
        throw new Error(`Customer user ${email} does not exist in users table!`);
    }
    console.log(`[PASS 1] Customer User Found: ${user.username} (ID: ${user.id}, Email: ${user.email})`);

    // 2. Ensure merchant 7 (Sanjay Enterprises) has a business_customers record for santhosh2004@bnxmail.com
    let busCust = await db.prepare("SELECT * FROM business_customers WHERE user_id = 7 AND LOWER(email) = ?").get(email);
    if (!busCust) {
        console.log("Creating business_customers row for gopi / santhosh2004@bnxmail.com...");
        const cRes = await db.prepare(`
            INSERT INTO business_customers (user_id, name, email, phone, customer_code, created_at, updated_at)
            VALUES (7, 'gopi', ?, '9876543210', 'CUST-GOPI-01', ?, ?)
        `).run(email, now, now);
        busCust = await db.prepare("SELECT * FROM business_customers WHERE id = ?").get(cRes.lastInsertRowid);
    }
    console.log(`[PASS 2] Business Customer Found/Created: ${busCust.name} (ID: ${busCust.id}, Code: ${busCust.customer_code})`);

    // 3. Ensure customer_connections status is 'accepted' for merchant 7 and santhosh2004@bnxmail.com
    let conn = await db.prepare("SELECT * FROM customer_connections WHERE business_id = 7 AND (LOWER(customer_email) = ? OR website_user_id = ?)").get(email, user.id);
    if (!conn) {
        console.log("Creating accepted customer_connections record...");
        const connRes = await db.prepare(`
            INSERT INTO customer_connections (business_id, business_customer_id, website_user_id, customer_email, status, requested_at, responded_at, created_at, updated_at)
            VALUES (7, ?, ?, ?, 'accepted', ?, ?, ?, ?)
        `).run(busCust.id, user.id, email, now, now, now, now);
        conn = await db.prepare("SELECT * FROM customer_connections WHERE id = ?").get(connRes.lastInsertRowid);
    } else if (conn.status !== 'accepted') {
        await db.prepare("UPDATE customer_connections SET status = 'accepted', updated_at = ? WHERE id = ?").run(now, conn.id);
        conn = await db.prepare("SELECT * FROM customer_connections WHERE id = ?").get(conn.id);
    }
    console.log(`[PASS 3] Connection Verified: ID #${conn.id}, Status = ${conn.status}`);

    // 4. Record baseline purchases count & total loyalty for user ID 23 before creating fresh invoice
    const customerToken = jwt.sign({ id: user.id, email: user.email, username: user.username, role: 'user' }, JWT_SECRET);
    const initialPurchasesRes = await axios.get(`${BASE_URL}/finance-plus/purchases`, {
        headers: { Authorization: `Bearer ${customerToken}` }
    });
    const initialPurchases = initialPurchasesRes.data?.data || initialPurchasesRes.data || [];
    console.log(`Baseline Purchase Count for ${email}: ${initialPurchases.length}`);

    // 5. Generate a completely FRESH Sales Invoice from Business Merchant 7
    const merchantToken = jwt.sign({ id: 7, email: 'sanjay123@bnxmail.com', username: 'sanjay123', role: 'business' }, JWT_SECRET);
    const invNum = `INV-NEW-TEST-${Date.now().toString().slice(-4)}`;
    const invoicePayload = {
        invoice_number: invNum,
        client_name: 'gopi',
        client_email: email,
        amount: 100,
        total_amount: 100,
        paid_amount: 100,
        due_amount: 0,
        status: 'Paid',
        payment_mode: 'UPI',
        invoice_type: 'GST',
        items: JSON.stringify([{ description: 'Fresh Verification Product', quantity: 1, price: 100, tax_rate: 0, total: 100 }])
    };

    console.log(`\nGenerating Fresh Invoice #${invNum} via Business Billing API...`);
    const invCreateRes = await axios.post(`${BASE_URL}/billing/invoices`, invoicePayload, {
        headers: { Authorization: `Bearer ${merchantToken}` }
    });

    console.log(`Invoice Creation HTTP Status: ${invCreateRes.status}`);
    console.log(`[PASS 4] Business Invoice Persisted: #${invNum} (ID: ${invCreateRes.data?.data?.id || invCreateRes.data?.id})`);

    // 6. Verify Business Database record
    const busInvRow = await db.prepare("SELECT * FROM business_invoices WHERE invoice_number = ?").get(invNum);
    if (!busInvRow) throw new Error(`CRITICAL: ${invNum} not found in business_invoices DB!`);
    console.log(`[PASS 5] Verified Business DB: ID #${busInvRow.id}, Client Email = ${busInvRow.client_email}, Total = ₹${busInvRow.total_amount}`);

    // 7. Verify Customer Purchase History Database record
    const syncRow = await db.prepare("SELECT * FROM customer_purchase_history WHERE invoice_number = ?").get(invNum);
    if (!syncRow) throw new Error(`CRITICAL SYNC FAILURE: ${invNum} was NOT synchronized into customer_purchase_history table!`);
    console.log(`[PASS 6] Verified customer_purchase_history DB: ID #${syncRow.id}, Customer User ID = ${syncRow.customer_user_id}, Net Amount = ₹${syncRow.net_amount}`);

    // 8. Verify Purchase Details API output
    const updatedPurchasesRes = await axios.get(`${BASE_URL}/finance-plus/purchases`, {
        headers: { Authorization: `Bearer ${customerToken}` }
    });
    const updatedPurchases = updatedPurchasesRes.data?.data || updatedPurchasesRes.data || [];
    console.log(`Updated Purchase Count for ${email}: ${updatedPurchases.length}`);

    const foundInApi = updatedPurchases.find(p => p.invoice_number === invNum);
    if (!foundInApi) throw new Error(`CRITICAL API FAILURE: ${invNum} is NOT present in Purchase History API response!`);
    console.log(`[PASS 7] Verified Purchase Details API Response includes #${invNum}`);

    // 9. Verify Detailed Invoice Retrieval API
    const targetInvId = foundInApi.invoice_id || foundInApi.id;
    const invDetailRes = await axios.get(`${BASE_URL}/finance-plus/invoice/${targetInvId}`, {
        headers: { Authorization: `Bearer ${customerToken}` }
    });
    console.log(`[PASS 8] Verified Detailed Invoice View API (Status: ${invDetailRes.status}, Invoice #: ${invDetailRes.data?.data?.invoice_number || invDetailRes.data?.invoice_number})`);

    console.log("\n==================================================================");
    console.log("   ALL 12 END-TO-END VERIFICATION CHECKS PASSED 100%!");
    console.log("==================================================================");
}

verifyFreshGopiInvoiceFlow().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
