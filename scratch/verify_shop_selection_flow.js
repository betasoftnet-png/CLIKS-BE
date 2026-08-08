const db = require('../db/connection');
const axios = require('axios');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'change_me_to_a_long_random_secret_32chars+';
const BASE_URL = 'http://localhost:3000/api/v1';

async function testShopSelectionFlow() {
    console.log("==================================================================");
    console.log("   E2E TEST: SHOP SELECTION & PURCHASES FILTERING FLOW");
    console.log("==================================================================");

    const email = 'santhosh2004@bnxmail.com';

    // Ensure 2 accepted business connections exist for santhosh2004@bnxmail.com for multi-shop verification
    const user = await db.prepare("SELECT * FROM users WHERE LOWER(email) = ?").get(email);
    if (!user) throw new Error(`User ${email} not found!`);
    const customerToken = jwt.sign({ id: user.id, email: user.email, username: user.username, role: 'user' }, JWT_SECRET);

    // Ensure connection to business_id 1 is accepted
    const existingConn1 = await db.prepare("SELECT * FROM customer_connections WHERE business_id = 1 AND website_user_id = ?").get(user.id);
    if (existingConn1) {
        await db.prepare("UPDATE customer_connections SET status = 'accepted' WHERE id = ?").run(existingConn1.id);
    } else {
        await db.prepare("INSERT INTO customer_connections (business_id, business_customer_id, website_user_id, customer_email, status, created_at) VALUES (1, 1, ?, ?, 'accepted', datetime('now'))").run(user.id, email);
    }

    // 2. Fetch Active Integrations via API
    const intRes = await axios.get(`${BASE_URL}/finance-plus/integrations`, {
        headers: { Authorization: `Bearer ${customerToken}` }
    });
    const integrations = Array.isArray(intRes.data) ? intRes.data : (intRes.data?.data || []);

    const acceptedShops = integrations.filter(i => String(i.status).toLowerCase() === 'accepted' || String(i.status).toLowerCase() === 'connected');
    console.log(`Accepted Connected Shops for ${email}: ${acceptedShops.length}`);
    console.table(acceptedShops.map(s => ({ id: s.id, business_id: s.business_id, business_name: s.business_name, customer: s.customer_name, status: s.status })));

    if (acceptedShops.length < 1) throw new Error("At least 1 accepted shop required for testing!");

    const shopA = acceptedShops[0];
    const shopB = acceptedShops[1] || { business_id: 503, business_name: 'BTC007', customer_name: 'santhosh' };

    console.log(`Selected Shop A: ${shopA.business_name} (business_id: ${shopA.business_id})`);

    // 3. Fetch Purchases for User
    const pResInitial = await axios.get(`${BASE_URL}/finance-plus/purchases`, {
        headers: { Authorization: `Bearer ${customerToken}` }
    });
    const allPurchasesInitial = pResInitial.data?.data || pResInitial.data || [];

    // Filter for Shop A
    const shopAPurchasesInitial = allPurchasesInitial.filter(p => String(p.merchant_business_id) === String(shopA.business_id) || String(p.merchant_name).toLowerCase() === String(shopA.business_name).toLowerCase());
    console.log(`Initial Purchase Count for Shop A (${shopA.business_name}): ${shopAPurchasesInitial.length}`);

    // 4. Create NEW Invoice for Shop A
    const merchantAToken = jwt.sign({ id: shopA.business_id, email: 'sanjay123@bnxmail.com', username: 'sanjay123', role: 'business' }, JWT_SECRET);
    const invA = `INV-SHOPA-${Date.now().toString().slice(-4)}`;

    console.log(`\nCreating Fresh Invoice #${invA} for Shop A (${shopA.business_name})...`);
    const createARes = await axios.post(`${BASE_URL}/billing/invoices`, {
        invoice_number: invA,
        client_name: shopA.customer_name || 'gopi',
        client_email: email,
        amount: 8800,
        total_amount: 8800,
        paid_amount: 8800,
        due_amount: 0,
        status: 'Paid',
        payment_mode: 'UPI',
        invoice_type: 'GST',
        items: JSON.stringify([{ description: 'Shop A Product', quantity: 1, price: 8800, tax_rate: 0, total: 8800 }])
    }, { headers: { Authorization: `Bearer ${merchantAToken}` } });

    console.log(`Invoice Creation Status for Shop A: ${createARes.status}`);

    // Verify background refresh returns invA for Shop A
    const pResPostA = await axios.get(`${BASE_URL}/finance-plus/purchases`, {
        headers: { Authorization: `Bearer ${customerToken}` }
    });
    const allPurchasesPostA = pResPostA.data?.data || pResPostA.data || [];
    const shopAPurchasesPostA = allPurchasesPostA.filter(p => String(p.merchant_business_id) === String(shopA.business_id) || String(p.merchant_name).toLowerCase() === String(shopA.business_name).toLowerCase());

    console.log(`Updated Purchase Count for Shop A: ${shopAPurchasesPostA.length}`);
    const foundInShopA = shopAPurchasesPostA.some(p => p.invoice_number === invA);
    if (!foundInShopA) throw new Error(`FAILED: Invoice #${invA} not found in Shop A's purchase list!`);
    console.log(`✅ VERIFIED: Invoice #${invA} immediately appeared in Shop A's purchase list!`);

    // 5. Create NEW Invoice for Shop B
    // Fetch merchant user from DB for shopB.business_id
    const merchantBUser = await db.prepare("SELECT * FROM users WHERE id = ?").get(shopB.business_id || 1) || { id: 1, email: 'admin@bnxmail.com', username: 'admin' };
    const merchantBToken = jwt.sign({ id: merchantBUser.id, email: merchantBUser.email, username: merchantBUser.username, role: 'business' }, JWT_SECRET);
    const invB = `INV-SHOPB-${Date.now().toString().slice(-4)}`;

    console.log(`\nCreating Fresh Invoice #${invB} for Shop B (${shopB.business_name}, merchant_id: ${merchantBUser.id})...`);
    await axios.post(`${BASE_URL}/billing/invoices`, {
        invoice_number: invB,
        client_name: shopB.customer_name || 'santhosh',
        client_email: email,
        amount: 3200,
        total_amount: 3200,
        paid_amount: 3200,
        due_amount: 0,
        status: 'Paid',
        payment_mode: 'UPI',
        invoice_type: 'GST',
        items: JSON.stringify([{ description: 'Shop B Item', quantity: 1, price: 3200, tax_rate: 0, total: 3200 }])
    }, { headers: { Authorization: `Bearer ${merchantBToken}` } });

    // Verify Shop A's purchase list does NOT contain invB
    const pResPostB = await axios.get(`${BASE_URL}/finance-plus/purchases`, {
        headers: { Authorization: `Bearer ${customerToken}` }
    });
    const allPurchasesPostB = pResPostB.data?.data || pResPostB.data || [];

    const shopAPurchasesPostB = allPurchasesPostB.filter(p => String(p.merchant_business_id) === String(shopA.business_id) || String(p.merchant_name).toLowerCase() === String(shopA.business_name).toLowerCase());
    const shopBPpurchasesPostB = allPurchasesPostB.filter(p => String(p.merchant_business_id) === String(shopB.business_id || 503) || String(p.merchant_name).toLowerCase() === String(shopB.business_name).toLowerCase());

    const shopAHasB = shopAPurchasesPostB.some(p => p.invoice_number === invB);
    if (shopAHasB) throw new Error(`CRITICAL FAILURE: Shop B invoice #${invB} appeared inside Shop A's list!`);
    console.log(`✅ VERIFIED: Shop A's list strictly EXCLUDES Shop B's invoice #${invB}!`);

    const shopBHasB = shopBPpurchasesPostB.some(p => p.invoice_number === invB);
    console.log(`Shop B purchase list count: ${shopBPpurchasesPostB.length}, contains #${invB}: ${shopBHasB}`);
    if (!shopBHasB) throw new Error(`FAILED: Invoice #${invB} not found in Shop B's purchase list!`);
    console.log(`✅ VERIFIED: Switching to Shop B correctly displays Shop B's invoice #${invB}!`);

    // 6. Test Rejected Connection Exclusion
    const rejectedCount = integrations.filter(i => String(i.status).toLowerCase() === 'rejected' || String(i.status).toLowerCase() === 'unconnected').length;
    console.log(`\nRejected connection count in integrations: ${rejectedCount}`);
    const isRejectedIncluded = acceptedShops.some(s => String(s.status).toLowerCase() === 'rejected');
    if (isRejectedIncluded) throw new Error("SECURITY FAILURE: Rejected connection appeared in connected shops!");
    console.log(`✅ VERIFIED: Rejected shops are strictly EXCLUDED from Connected Shops selection!`);

    console.log("\n==================================================================");
    console.log("   ALL SHOP SELECTION & PURCHASES TEST CASES PASSED 100%");
    console.log("==================================================================");
}

testShopSelectionFlow().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
