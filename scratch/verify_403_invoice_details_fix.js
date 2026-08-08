const db = require('../db/connection');
const axios = require('axios');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'change_me_to_a_long_random_secret_32chars+';
const BASE_URL = 'http://localhost:3000/api/v1';

async function verifyInvoiceDetailsFix() {
    console.log("==================================================================");
    console.log("   VERIFYING 403 UNAUTHORIZED INVOICE DETAILS FIX FOR TATA123");
    console.log("==================================================================");

    // 1. Get Website Customer User tata123 (user ID: 26)
    let user = await db.prepare("SELECT * FROM users WHERE LOWER(email) = 'tata123@bnxmail.com'").get();
    if (!user) {
        throw new Error("Customer user tata123@bnxmail.com not found!");
    }

    console.log(`Testing with User: ${user.username} (ID: ${user.id}, Email: ${user.email})`);
    const token = jwt.sign({ id: user.id, email: user.email, username: user.username, role: 'user' }, JWT_SECRET);

    // 2. Fetch purchases from finance-plus API
    const purchasesRes = await axios.get(`${BASE_URL}/finance-plus/purchases`, {
        headers: { Authorization: `Bearer ${token}` }
    });

    const purchases = purchasesRes.data?.data || purchasesRes.data || [];
    console.log(`Fetched ${purchases.length} purchases from /finance-plus/purchases API.`);

    // 3. Test GET /api/v1/finance-plus/invoice/:id for each purchase of tata123
    for (const p of purchases) {
        const targetId = p.invoice_id || p.id;
        console.log(`\nTesting GET ${BASE_URL}/finance-plus/invoice/${targetId} (Invoice #${p.invoice_number})...`);

        try {
            const invRes = await axios.get(`${BASE_URL}/finance-plus/invoice/${targetId}`, {
                headers: { Authorization: `Bearer ${token}` }
            });

            console.log(`HTTP Status: ${invRes.status}`);
            console.log("Response Data Summary:", {
                invoice_number: invRes.data?.data?.invoice_number || invRes.data?.invoice_number,
                grand_total: invRes.data?.data?.grand_total || invRes.data?.grand_total,
                status: invRes.data?.data?.invoice_status || invRes.data?.data?.status || 'Paid',
                merchant_name: invRes.data?.data?.merchant?.name || invRes.data?.data?.merchant_name
            });
            console.log("✅ Successfully retrieved invoice details without 403 Forbidden!");
        } catch (err) {
            console.error(`❌ FAILED for invoice ID ${targetId}:`, err.response?.status, err.response?.data || err.message);
            throw err;
        }
    }

    console.log("\n==================================================================");
    console.log("   403 INVOICE DETAILS FIX VERIFIED 100% SUCCESSFUL!");
    console.log("==================================================================");
}

verifyInvoiceDetailsFix().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
