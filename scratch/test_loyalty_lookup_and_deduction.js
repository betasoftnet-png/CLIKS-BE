const db = require('../db/connection');
const { runMigrations } = require('../db/migrations');
const { processCustomerInvoiceIntegration } = require('../utils/customerIntegration');

async function runTest() {
    console.log('--- TESTING LOYALTY LOOKUP & DEDUCTION ---');
    await runMigrations();

    const now = new Date().toISOString();
    const testEmail = 'santhosh2004@bnxmail.com';

    // 1. Create or ensure customer exists with 1878 points
    let user = await db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(testEmail);
    if (!user) {
        const uRes = await db.prepare(`
            INSERT INTO users (username, email, password_hash, role, loyalty_points, created_at, updated_at)
            VALUES ('santhosh2004', ?, 'hash123', 'user', 1878, ?, ?)
        `).run(testEmail, now, now);
        user = await db.prepare('SELECT * FROM users WHERE id = ?').get(uRes.lastInsertRowid);
    } else {
        await db.prepare('UPDATE users SET loyalty_points = 1878 WHERE id = ?').run(user.id);
    }

    // Ensure wallet table has 1878 points
    const wallet = await db.prepare('SELECT * FROM customer_loyalty_wallets WHERE user_id = ?').get(user.id);
    if (wallet) {
        await db.prepare('UPDATE customer_loyalty_wallets SET points_balance = 1878 WHERE user_id = ?').run(user.id);
    } else {
        await db.prepare(`
            INSERT INTO customer_loyalty_wallets (user_id, points_balance, total_earned, total_redeemed, created_at, updated_at)
            VALUES (?, 1878, 1878, 0, ?, ?)
        `).run(user.id, now, now);
    }

    // 2. Perform Lookup Test
    const fetchedUser = await db.prepare('SELECT id, email, username, loyalty_points FROM users WHERE LOWER(email) = ?').get(testEmail);
    const fetchedWallet = await db.prepare('SELECT points_balance FROM customer_loyalty_wallets WHERE user_id = ?').get(fetchedUser.id);
    const pts = fetchedWallet ? fetchedWallet.points_balance : fetchedUser.loyalty_points;

    console.log(`✅ Lookup Customer Email: ${testEmail}`);
    console.log(`✅ Live Database Loyalty Balance: ${pts} points`);

    if (pts !== 1878) {
        throw new Error(`FAILED: Expected 1878 points, got ${pts}`);
    }

    // 3. Create invoice with 500 redeemed points and total bill of 18,255 (earns 182 points)
    const invNum = `INV-REDEEM-${Date.now().toString().slice(-4)}`;
    const invoicePayload = {
        user_id: 1,
        invoice_number: invNum,
        client_name: 'santhosh',
        client_email: testEmail,
        amount: 15470,
        tax_amount: 2784.6,
        total_amount: 18255,
        paid_amount: 18255,
        due_amount: 0,
        discount_amount: 1530,
        round_off: 0.4,
        status: 'Paid',
        due_date: '2026-08-06',
        payment_mode: 'UPI',
        invoice_type: 'GST',
        tax_type: 'Exclusive',
        redeemed_points: 500,
        items: JSON.stringify([{ description: 'vivo', quantity: 1, price: 17000 }]),
        created_at: now,
        updated_at: now
    };

    const invInsert = await db.prepare(`
        INSERT INTO business_invoices (
            user_id, invoice_number, client_name, client_email, amount, tax_amount, total_amount,
            paid_amount, due_amount, discount_amount, round_off, status, due_date,
            payment_mode, invoice_type, tax_type, items, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        invoicePayload.user_id, invoicePayload.invoice_number, invoicePayload.client_name, invoicePayload.client_email,
        invoicePayload.amount, invoicePayload.tax_amount, invoicePayload.total_amount, invoicePayload.paid_amount, invoicePayload.due_amount,
        invoicePayload.discount_amount, invoicePayload.round_off, invoicePayload.status, invoicePayload.due_date, invoicePayload.payment_mode,
        invoicePayload.invoice_type, invoicePayload.tax_type, invoicePayload.items, invoicePayload.created_at, invoicePayload.updated_at
    );

    const createdInvoice = await db.prepare('SELECT * FROM business_invoices WHERE id = ?').get(invInsert.lastInsertRowid);
    createdInvoice.redeemed_points = 500;

    // Trigger processCustomerInvoiceIntegration
    await processCustomerInvoiceIntegration({
        createdInvoice,
        merchantUserId: 1
    });

    // 4. Assert updated balance after deduction & earning (1878 - 500 + 182 = 1560)
    const updatedWallet = await db.prepare('SELECT * FROM customer_loyalty_wallets WHERE user_id = ?').get(user.id);
    const updatedUser = await db.prepare('SELECT loyalty_points FROM users WHERE id = ?').get(user.id);

    console.log(`✅ Updated Wallet Balance after invoice redemption (-500) and earn (+182): ${updatedWallet.points_balance}`);
    console.log(`✅ Updated Users Table Loyalty Points: ${updatedUser.loyalty_points}`);

    if (updatedWallet.points_balance !== 1560 || updatedUser.loyalty_points !== 1560) {
        throw new Error(`FAILED: Expected 1560 points, got wallet=${updatedWallet.points_balance}, user=${updatedUser.loyalty_points}`);
    }

    console.log('--- ALL LOYALTY LOOKUP & DEDUCTION TESTS PASSED! ---');
    process.exit(0);
}

runTest().catch(err => {
    console.error('❌ TEST FAILED:', err);
    process.exit(1);
});
