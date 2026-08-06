const db = require('../db/connection');
const { runMigrations } = require('../db/migrations');
const { processCustomerInvoiceIntegration } = require('../utils/customerIntegration');
const customerPurchaseController = require('../controllers/customerPurchaseController');

async function runTest() {
    console.log('--- TESTING MERCHANT-SPECIFIC LOYALTY CALCULATION ---');
    await runMigrations();

    const now = new Date().toISOString();
    const customerEmail = 'santhosh2004@bnxmail.com';

    // Ensure customer exists
    let customer = await db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(customerEmail);
    if (!customer) {
        const cRes = await db.prepare(`
            INSERT INTO users (username, email, password_hash, role, loyalty_points, created_at, updated_at)
            VALUES ('santhosh2004', ?, 'hash123', 'user', 2110, ?, ?)
        `).run(customerEmail, now, now);
        customer = await db.prepare('SELECT * FROM users WHERE id = ?').get(cRes.lastInsertRowid);
    }

    // Clean old purchase history for test customer
    await db.prepare('DELETE FROM customer_purchase_history WHERE LOWER(customer_email) = ?').run(customerEmail);

    // Create 3 merchants
    // Merchant 1: dineshkumar90 (2 purchases: 24 + 18 = 42 pts)
    // Merchant 2: santhoshhhhhhhh (1 purchase: 190 pts)
    // Merchant 3: sanjay123 (3 purchases: 1642 + 118 + 118 = 1878 pts)

    const insertPurchase = async (invNum, mId, mName, totalAmt, ptsEarned) => {
        await db.prepare(`
            INSERT INTO customer_purchase_history (
                invoice_number, invoice_type, invoice_date, due_date, invoice_status,
                payment_status, payment_mode, merchant_business_id, merchant_name,
                customer_user_id, customer_name, customer_email, total_amount, gst, discount,
                net_amount, paid_amount, due_amount, points_earned, points_redeemed, net_points_added,
                invoice_id, items, created_at, updated_at
            ) VALUES (?, 'GST', ?, '', 'Paid', 'Paid', 'Cash', ?, ?, ?, 'santhosh', ?, ?, 0, 0, ?, ?, 0, ?, 0, ?, 1, '[]', ?, ?)
        `).run(
            invNum, now, mId, mName, customer.id, customerEmail, totalAmt, totalAmt, totalAmt, ptsEarned, ptsEarned, now, now
        );
    };

    // Merchant 1 (dineshkumar90)
    await insertPurchase('INV-DK-1', 501, 'dineshkumar90', 2400, 24);
    await insertPurchase('INV-DK-2', 501, 'dineshkumar90', 1800, 18);

    // Merchant 2 (santhoshhhhhhhh)
    await insertPurchase('INV-SH-1', 502, 'santhoshhhhhhhh', 19000, 190);

    // Merchant 3 (sanjay123)
    await insertPurchase('INV-SJ-1', 503, 'sanjay123', 164200, 1642);
    await insertPurchase('INV-SJ-2', 503, 'sanjay123', 11800, 118);
    await insertPurchase('INV-SJ-3', 503, 'sanjay123', 11800, 118);

    // Test 1: getMerchantSummary API
    const mockRes1 = {
        statusCode: 200,
        responseData: null,
        status(c) { this.statusCode = c; return this; },
        json(d) { this.responseData = d; return this; }
    };
    const req = { user: { id: customer.id, email: customerEmail } };

    await customerPurchaseController.getMerchantSummary(req, mockRes1);
    const summaryCards = mockRes1.responseData?.data || mockRes1.responseData;

    console.log('--- MERCHANT SUMMARY CARDS ---');
    console.log(summaryCards);

    const cardDK = summaryCards.find(m => String(m.merchant_business_id) === '501' || m.merchant_name === 'dineshkumar90');
    const cardSH = summaryCards.find(m => String(m.merchant_business_id) === '502' || m.merchant_name === 'santhoshhhhhhhh');
    const cardSJ = summaryCards.find(m => String(m.merchant_business_id) === '503' || m.merchant_name === 'sanjay123');

    console.log(`✅ Merchant dineshkumar90: Purchases = ${cardDK?.purchases_count}, Loyalty Earned = ${cardDK?.points_earned} pts`);
    console.log(`✅ Merchant santhoshhhhhhhh: Purchases = ${cardSH?.purchases_count}, Loyalty Earned = ${cardSH?.points_earned} pts`);
    console.log(`✅ Merchant sanjay123: Purchases = ${cardSJ?.purchases_count}, Loyalty Earned = ${cardSJ?.points_earned} pts`);

    if (cardDK?.purchases_count !== 2 || cardDK?.points_earned !== 42) {
        throw new Error(`FAILED: dineshkumar90 expected 2 purchases & 42 pts, got ${cardDK?.purchases_count} & ${cardDK?.points_earned}`);
    }
    if (cardSH?.purchases_count !== 1 || cardSH?.points_earned !== 190) {
        throw new Error(`FAILED: santhoshhhhhhhh expected 1 purchase & 190 pts, got ${cardSH?.purchases_count} & ${cardSH?.points_earned}`);
    }
    if (cardSJ?.purchases_count !== 3 || cardSJ?.points_earned !== 1878) {
        throw new Error(`FAILED: sanjay123 expected 3 purchases & 1878 pts, got ${cardSJ?.purchases_count} & ${cardSJ?.points_earned}`);
    }

    // Test 2: getPurchaseHistory API (attached attributes)
    const mockRes2 = {
        statusCode: 200,
        responseData: null,
        status(c) { this.statusCode = c; return this; },
        json(d) { this.responseData = d; return this; }
    };
    await customerPurchaseController.getPurchaseHistory(req, mockRes2);
    const purchaseHistoryList = mockRes2.responseData?.data || mockRes2.responseData;

    const dkItem = purchaseHistoryList.find(p => p.merchant_name === 'dineshkumar90');
    console.log(`✅ getPurchaseHistory item for dineshkumar90: loyalty_points = ${dkItem.loyalty_points}, merchant_loyalty_earned = ${dkItem.merchant_loyalty_earned}`);

    if (dkItem.loyalty_points !== 42 || dkItem.merchant_loyalty_earned !== 42) {
        throw new Error(`FAILED: getPurchaseHistory attached points expected 42, got ${dkItem.loyalty_points}`);
    }

    // Test 3: getMerchantHistory API (Filtered History Popup)
    const mockRes3 = {
        statusCode: 200,
        responseData: null,
        status(c) { this.statusCode = c; return this; },
        json(d) { this.responseData = d; return this; }
    };
    const reqFiltered = { params: { merchantId: '501' }, user: { id: customer.id, email: customerEmail } };
    await customerPurchaseController.getMerchantHistory(reqFiltered, mockRes3);
    const historyPopupData = mockRes3.responseData?.data || mockRes3.responseData;

    console.log('--- MERCHANT HISTORY POPUP DATA (dineshkumar90) ---');
    console.log('Total Purchases:', historyPopupData?.total_purchases);
    console.log('Merchant Loyalty Earned:', historyPopupData?.merchant_loyalty_earned);

    if (historyPopupData?.total_purchases !== 2 || historyPopupData?.merchant_loyalty_earned !== 42) {
        throw new Error('FAILED: Merchant history popup data mismatch!');
    }

    console.log('--- ALL MERCHANT-SPECIFIC LOYALTY CALCULATION TESTS PASSED CLEANLY! ---');
    process.exit(0);
}

runTest().catch(err => {
    console.error('❌ TEST FAILED:', err);
    process.exit(1);
});
