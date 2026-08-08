const db = require('../db/connection');
const axios = require('axios');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'change_me_to_a_long_random_secret_32chars+';
const BASE_URL = 'http://localhost:3000/api/v1';

async function runInvestigation() {
    console.log("==================================================================");
    console.log("   DEEP SYSTEM INVESTIGATION: OLD VS NEW INVOICE SYNC FLOW");
    console.log("==================================================================");

    // 1. Fetch old invoice that is known to appear correctly on CLIKS Website (e.g. INV-449870 or INV-798706 or INV-394480)
    const oldInvNumber = 'INV-449870';
    const oldBusInv = await db.prepare("SELECT * FROM business_invoices WHERE invoice_number = ? LIMIT 1").get(oldInvNumber);
    const oldPurchHist = await db.prepare("SELECT * FROM customer_purchase_history WHERE invoice_number = ? LIMIT 1").get(oldInvNumber);

    console.log("\n--- 1. OLD INVOICE DATA (INV-449870) ---");
    console.log("Business Invoice DB Record:", oldBusInv ? {
        id: oldBusInv.id,
        user_id: oldBusInv.user_id,
        invoice_number: oldBusInv.invoice_number,
        client_name: oldBusInv.client_name,
        client_email: oldBusInv.client_email,
        total_amount: oldBusInv.total_amount,
        status: oldBusInv.status,
        created_at: oldBusInv.created_at
    } : 'NOT FOUND IN business_invoices');

    console.log("Customer Purchase History DB Record:", oldPurchHist ? {
        id: oldPurchHist.id,
        invoice_id: oldPurchHist.invoice_id,
        merchant_business_id: oldPurchHist.merchant_business_id,
        customer_user_id: oldPurchHist.customer_user_id,
        customer_email: oldPurchHist.customer_email,
        invoice_number: oldPurchHist.invoice_number,
        net_amount: oldPurchHist.net_amount,
        total_amount: oldPurchHist.total_amount,
        created_at: oldPurchHist.created_at
    } : 'NOT FOUND IN customer_purchase_history');

    // 2. Fetch all business invoices to find any NEW invoices created recently in CLIKS Business
    const allInvoices = await db.prepare("SELECT * FROM business_invoices ORDER BY id DESC LIMIT 15").all();
    console.log("\n--- 2. ALL RECENT BUSINESS INVOICES IN DB ---");
    console.table(allInvoices.map(i => ({
        id: i.id,
        merchant_id: i.user_id,
        invoice_number: i.invoice_number,
        client_name: i.client_name,
        client_email: i.client_email,
        total_amount: i.total_amount || i.grand_total,
        status: i.status,
        created_at: i.created_at
    })));

    // 3. Check customer_connections in DB
    const connections = await db.prepare("SELECT * FROM customer_connections").all();
    console.log("\n--- 3. ALL CUSTOMER CONNECTIONS IN DB ---");
    console.table(connections.map(c => ({
        id: c.id,
        business_id: c.business_id,
        business_customer_id: c.business_customer_id,
        website_user_id: c.website_user_id,
        customer_email: c.customer_email,
        status: c.status
    })));

    // 4. Check customer_purchase_history in DB
    const allHistory = await db.prepare("SELECT * FROM customer_purchase_history ORDER BY id DESC LIMIT 15").all();
    console.log("\n--- 4. ALL RECENT CUSTOMER PURCHASE HISTORY IN DB ---");
    console.table(allHistory.map(h => ({
        id: h.id,
        invoice_id: h.invoice_id,
        invoice_number: h.invoice_number,
        merchant_business_id: h.merchant_business_id,
        customer_user_id: h.customer_user_id,
        customer_email: h.customer_email,
        net_amount: h.net_amount,
        created_at: h.created_at
    })));

    // 5. Test API for Website user tata123@bnxmail.com (user ID: 26) and santhosh2004@bnxmail.com (user ID: 23)
    const tataUser = await db.prepare("SELECT * FROM users WHERE LOWER(email) = 'tata123@bnxmail.com'").get();
    if (tataUser) {
        const token = jwt.sign({ id: tataUser.id, email: tataUser.email, username: tataUser.username, role: 'user' }, JWT_SECRET);
        const res = await axios.get(`${BASE_URL}/finance-plus/purchases`, { headers: { Authorization: `Bearer ${token}` } });
        console.log(`\n--- 5. API Response for tata123@bnxmail.com (${res.data?.data?.length || res.data?.length || 0} items) ---`);
        console.table((res.data?.data || res.data || []).map(p => ({
            id: p.id,
            invoice_id: p.invoice_id,
            invoice_number: p.invoice_number,
            merchant_name: p.merchant_name,
            grand_total: p.grand_total,
            points_earned: p.points_earned
        })));
    }

    const santhoshUser = await db.prepare("SELECT * FROM users WHERE LOWER(email) = 'santhosh2004@bnxmail.com'").get();
    if (santhoshUser) {
        const token = jwt.sign({ id: santhoshUser.id, email: santhoshUser.email, username: santhoshUser.username, role: 'user' }, JWT_SECRET);
        const res = await axios.get(`${BASE_URL}/finance-plus/purchases`, { headers: { Authorization: `Bearer ${token}` } });
        console.log(`\n--- 6. API Response for santhosh2004@bnxmail.com (${res.data?.data?.length || res.data?.length || 0} items) ---`);
        console.table((res.data?.data || res.data || []).map(p => ({
            id: p.id,
            invoice_id: p.invoice_id,
            invoice_number: p.invoice_number,
            merchant_name: p.merchant_name,
            grand_total: p.grand_total,
            points_earned: p.points_earned
        })));
    }

    // 6. Test generating a BRAND NEW invoice via HTTP POST /api/v1/billing/invoices right now and trace it
    console.log("\n==================================================================");
    console.log("   TESTING FRESH INVOICE CREATION FLOW OVER LIVE HTTP API");
    console.log("==================================================================");

    const freshInvNum = `INV-INVESTIGATE-${Date.now().toString().slice(-4)}`;
    const merchantToken = jwt.sign({ id: 7, email: 'sanjay123@bnxmail.com', username: 'sanjay123', role: 'business' }, JWT_SECRET);

    console.log(`Creating fresh invoice #${freshInvNum} for client_name: 'gopi', client_email: 'santhosh2004@bnxmail.com'...`);

    const createRes = await axios.post(`${BASE_URL}/billing/invoices`, {
        invoice_number: freshInvNum,
        client_name: 'gopi',
        client_email: 'santhosh2004@bnxmail.com',
        amount: 3500,
        total_amount: 3500,
        paid_amount: 3500,
        due_amount: 0,
        status: 'Paid',
        payment_mode: 'UPI',
        invoice_type: 'GST',
        items: JSON.stringify([{ description: 'Investigation Product', quantity: 1, price: 3500, tax_rate: 0, total: 3500 }])
    }, { headers: { Authorization: `Bearer ${merchantToken}` } });

    console.log("Fresh Invoice Creation Response HTTP Status:", createRes.status);
    console.log("Created Invoice Data:", createRes.data?.data || createRes.data);

    // Check if fresh invoice is in business_invoices
    const freshBusInv = await db.prepare("SELECT * FROM business_invoices WHERE invoice_number = ?").get(freshInvNum);
    console.log("\nFresh Invoice in business_invoices DB:", freshBusInv ? {
        id: freshBusInv.id,
        user_id: freshBusInv.user_id,
        invoice_number: freshBusInv.invoice_number,
        client_name: freshBusInv.client_name,
        client_email: freshBusInv.client_email,
        total_amount: freshBusInv.total_amount,
        status: freshBusInv.status
    } : 'NOT FOUND IN business_invoices');

    // Check if fresh invoice is in customer_purchase_history
    const freshHist = await db.prepare("SELECT * FROM customer_purchase_history WHERE invoice_number = ?").get(freshInvNum);
    console.log("\nFresh Invoice in customer_purchase_history DB:", freshHist ? {
        id: freshHist.id,
        invoice_id: freshHist.invoice_id,
        merchant_business_id: freshHist.merchant_business_id,
        customer_user_id: freshHist.customer_user_id,
        customer_email: freshHist.customer_email,
        invoice_number: freshHist.invoice_number,
        net_amount: freshHist.net_amount
    } : 'NOT FOUND IN customer_purchase_history');

    // Check if fresh invoice is returned by Website Purchase History API for santhosh2004@bnxmail.com
    if (santhoshUser) {
        const token = jwt.sign({ id: santhoshUser.id, email: santhoshUser.email, username: santhoshUser.username, role: 'user' }, JWT_SECRET);
        const apiRes = await axios.get(`${BASE_URL}/finance-plus/purchases`, { headers: { Authorization: `Bearer ${token}` } });
        const items = apiRes.data?.data || apiRes.data || [];
        const found = items.find(x => x.invoice_number === freshInvNum);
        console.log(`\nFresh Invoice in Purchase History API response for santhosh2004@bnxmail.com:`, found ? 'FOUND SUCCESS' : 'NOT FOUND IN API RESPONSE');
    }
}

runInvestigation().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
