const db = require('../db/connection');
const b2bConnectionService = require('../utils/b2bConnectionService');

async function runGenericB2BTest() {
    console.log('=== STARTING GENERIC MULTI-BUSINESS B2B CONNECTION & SYNC TEST ===\n');

    await b2bConnectionService.ensureTable();
    const now = new Date().toISOString();

    // ── TEST 1: EMAIL DOMAIN & ACCOUNT VALIDATION CHECKS ──────────────────────────────
    console.log('--- Test 1: Email Restrictions (@bnxmail.com) & Account Validation ---');

    // 1a. Test invalid email domain (e.g., gmail.com)
    try {
        await b2bConnectionService.createOrUpdateConnection({
            requester_user_id: 1,
            supplier_email: 'testuser@gmail.com',
            supplier_name: 'Gmail Vendor',
            isStrict: true
        });
        throw new Error('Should have rejected non-@bnxmail.com email!');
    } catch (err) {
        if (err.message === 'Only @bnxmail.com business emails are allowed.') {
            console.log('✓ Invalid domain correctly rejected with error:', `"${err.message}"`);
        } else {
            throw err;
        }
    }

    // 1b. Test unregistered @bnxmail.com email address
    try {
        await b2bConnectionService.createOrUpdateConnection({
            requester_user_id: 1,
            supplier_email: 'unregistered_999999@bnxmail.com',
            supplier_name: 'Unregistered Vendor',
            isStrict: true
        });
        throw new Error('Should have rejected unregistered @bnxmail.com email!');
    } catch (err) {
        if (err.message === 'No registered Cliks Business account found with this @bnxmail.com email address.') {
            console.log('✓ Unregistered email correctly rejected with error:', `"${err.message}"`);
        } else {
            throw err;
        }
    }
    console.log('✓ Test 1 Passed: Backend email domain & existence validation active!\n');

    // ── TEST 2: DYNAMIC PAIR A (companyX@bnxmail.com <-> companyY@bnxmail.com) ───────
    console.log('--- Test 2: Dynamic Business Pair A (companyX <-> companyY) ---');

    let compX = await db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get('companyx@bnxmail.com');
    if (!compX) {
        const res = await db.prepare(`
            INSERT INTO users (username, email, password_hash, business_name, created_at, updated_at)
            VALUES ('Company X Logistics', 'companyx@bnxmail.com', 'hash123', 'Company X Logistics Ltd', ?, ?)
        `).run(now, now);
        compX = await db.prepare('SELECT * FROM users WHERE id = ?').get(res.lastInsertRowid || res.id);
    }

    let compY = await db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get('companyy@bnxmail.com');
    if (!compY) {
        const res = await db.prepare(`
            INSERT INTO users (username, email, password_hash, business_name, created_at, updated_at)
            VALUES ('Company Y Manufacturing', 'companyy@bnxmail.com', 'hash123', 'Company Y Manufacturing Pvt', ?, ?)
        `).run(now, now);
        compY = await db.prepare('SELECT * FROM users WHERE id = ?').get(res.lastInsertRowid || res.id);
    }

    // Clean prior connection & invoice records
    await db.prepare('DELETE FROM b2b_connections WHERE (requester_user_id = ? AND target_user_id = ?) OR (requester_user_id = ? AND target_user_id = ?)').run(compX.id, compY.id, compY.id, compX.id);
    await db.prepare('DELETE FROM b2b_invoice_relationships WHERE buyer_user_id = ? AND supplier_user_id = ?').run(compX.id, compY.id);

    // Step A1: Company X sends Supplier Connection Request to Company Y
    const connA = await b2bConnectionService.createOrUpdateConnection({
        requester_user_id: compX.id,
        supplier_email: compY.email,
        supplier_name: compY.business_name,
        isStrict: true
    });
    console.log(`✓ Request created from ${compX.email} to ${compY.email} (ID: ${connA.id}, Status: ${connA.status})`);

    // Step A2: Company Y accepts connection
    const acceptedA = await b2bConnectionService.respondToConnection({
        user_id: compY.id,
        connection_id: connA.id,
        action: 'ACCEPT'
    });
    console.log(`✓ Company Y accepted request (Status: ${acceptedA.status})`);

    // Step A3: Company X submits Purchase Invoice against Company Y
    const poNumA = `PO-COMPX-${Date.now().toString().slice(-4)}`;
    const itemsA = [{ product_name: 'Steel Rods', sku: 'STL-900', quantity: 50, purchase_price: 1200, price: 1200, tax_amount: 10800, total: 70800 }];

    const purResA = await db.prepare(`
        INSERT INTO business_purchases (
            user_id, purchase_number, purchase_type, purchase_date, due_date, doc_type, status,
            supplier_name, supplier_gstin, payment_status, payment_mode,
            subtotal, total_discount, total_tax, grand_total, created_at, updated_at
        ) VALUES (?, ?, 'GST', ?, ?, 'PO', 'Approved', ?, '27XXXXX0000X1Z1', 'pending', 'Credit', 60000, 0, 10800, 70800, ?, ?)
    `).run(compX.id, poNumA, now.split('T')[0], now.split('T')[0], compY.business_name, now, now);

    const syncA = await b2bConnectionService.syncPurchaseToSalesInvoice({
        purchaseId: purResA.lastInsertRowid || purResA.id,
        userId: compX.id,
        supplierEmail: compY.email,
        purchaseData: {
            purchase_number: poNumA,
            subtotal: 60000,
            total_tax: 10800,
            total_discount: 0,
            grand_total: 70800,
            payment_status: 'pending',
            payment_mode: 'Credit',
            items: itemsA
        }
    });

    const salesInvA = await db.prepare('SELECT * FROM business_invoices WHERE id = ?').get(syncA.salesInvoiceId);
    console.log(`✓ Sales Invoice auto-created for Company Y (ID #${salesInvA.id}, Ref: ${salesInvA.invoice_number}, Buyer: ${salesInvA.client_name}, Total: ₹${salesInvA.total_amount})`);
    console.log(`✓ Notes Source Check: "${salesInvA.notes}"`);
    console.log('✓ Pair A Test Passed!\n');

    // ── TEST 3: DYNAMIC PAIR B (alphatech@bnxmail.com <-> betacorp@bnxmail.com) ────────
    console.log('--- Test 3: Dynamic Business Pair B (alphaTech <-> betaCorp) ---');

    let alpha = await db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get('alphatech@bnxmail.com');
    if (!alpha) {
        const res = await db.prepare(`
            INSERT INTO users (username, email, password_hash, business_name, created_at, updated_at)
            VALUES ('Alpha Tech Solutions', 'alphatech@bnxmail.com', 'hash123', 'Alpha Tech Solutions LLC', ?, ?)
        `).run(now, now);
        alpha = await db.prepare('SELECT * FROM users WHERE id = ?').get(res.lastInsertRowid || res.id);
    }

    let beta = await db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get('betacorp@bnxmail.com');
    if (!beta) {
        const res = await db.prepare(`
            INSERT INTO users (username, email, password_hash, business_name, created_at, updated_at)
            VALUES ('Beta Corp Systems', 'betacorp@bnxmail.com', 'hash123', 'Beta Corp Systems Inc', ?, ?)
        `).run(now, now);
        beta = await db.prepare('SELECT * FROM users WHERE id = ?').get(res.lastInsertRowid || res.id);
    }

    // Clean prior connection & invoice records
    await db.prepare('DELETE FROM b2b_connections WHERE (requester_user_id = ? AND target_user_id = ?) OR (requester_user_id = ? AND target_user_id = ?)').run(alpha.id, beta.id, beta.id, alpha.id);
    await db.prepare('DELETE FROM b2b_invoice_relationships WHERE buyer_user_id = ? AND supplier_user_id = ?').run(alpha.id, beta.id);

    // Step B1: Alpha Tech sends Supplier Connection Request to Beta Corp
    const connB = await b2bConnectionService.createOrUpdateConnection({
        requester_user_id: alpha.id,
        supplier_email: beta.email,
        supplier_name: beta.business_name,
        isStrict: true
    });
    console.log(`✓ Request created from ${alpha.email} to ${beta.email} (ID: ${connB.id}, Status: ${connB.status})`);

    // Step B2: Beta Corp accepts connection
    const acceptedB = await b2bConnectionService.respondToConnection({
        user_id: beta.id,
        connection_id: connB.id,
        action: 'ACCEPT'
    });
    console.log(`✓ Beta Corp accepted request (Status: ${acceptedB.status})`);

    // Step B3: Alpha Tech submits Purchase Invoice against Beta Corp
    const poNumB = `PO-ALPHA-${Date.now().toString().slice(-4)}`;
    const itemsB = [{ product_name: 'Cloud Servers', sku: 'SRV-500', quantity: 2, purchase_price: 25000, price: 25000, tax_amount: 9000, total: 59000 }];

    const purResB = await db.prepare(`
        INSERT INTO business_purchases (
            user_id, purchase_number, purchase_type, purchase_date, due_date, doc_type, status,
            supplier_name, supplier_gstin, payment_status, payment_mode,
            subtotal, total_discount, total_tax, grand_total, created_at, updated_at
        ) VALUES (?, ?, 'GST', ?, ?, 'PO', 'Approved', ?, '27YYYYY0000Y1Z2', 'paid', 'UPI', 50000, 0, 9000, 59000, ?, ?)
    `).run(alpha.id, poNumB, now.split('T')[0], now.split('T')[0], beta.business_name, now, now);

    const syncB = await b2bConnectionService.syncPurchaseToSalesInvoice({
        purchaseId: purResB.lastInsertRowid || purResB.id,
        userId: alpha.id,
        supplierEmail: beta.email,
        purchaseData: {
            purchase_number: poNumB,
            subtotal: 50000,
            total_tax: 9000,
            total_discount: 0,
            grand_total: 59000,
            payment_status: 'paid',
            payment_mode: 'UPI',
            items: itemsB
        }
    });

    const salesInvB = await db.prepare('SELECT * FROM business_invoices WHERE id = ?').get(syncB.salesInvoiceId);
    console.log(`✓ Sales Invoice auto-created for Beta Corp (ID #${salesInvB.id}, Ref: ${salesInvB.invoice_number}, Buyer: ${salesInvB.client_name}, Total: ₹${salesInvB.total_amount}, Status: ${salesInvB.status})`);
    console.log(`✓ Notes Source Check: "${salesInvB.notes}"`);
    console.log('✓ Pair B Test Passed!\n');

    // ── TEST 4: IDEMPOTENCY RETRY CHECK FOR PAIR B ──────────────────────────────────
    console.log('--- Test 4: Idempotency Retry Check for Pair B ---');
    const retryB = await b2bConnectionService.syncPurchaseToSalesInvoice({
        purchaseId: purResB.lastInsertRowid || purResB.id,
        userId: alpha.id,
        supplierEmail: beta.email,
        purchaseData: {
            purchase_number: poNumB,
            subtotal: 50000,
            total_tax: 9000,
            grand_total: 59000,
            items: itemsB
        }
    });
    const relCountB = await db.prepare('SELECT count(*) as c FROM b2b_invoice_relationships WHERE source_purchase_invoice_id = ?').get(purResB.lastInsertRowid || purResB.id);
    if (relCountB.c !== 1) throw new Error('Duplicate sales invoice was created on retry!');
    console.log('✓ Idempotency verified: Retrying sync returns existing relationship ID without duplicating Sales Invoices!\n');

    console.log('=== ALL GENERIC B2B MULTI-BUSINESS TESTS PASSED SUCCESSFULLY! ===');
}

runGenericB2BTest().catch(err => {
    console.error('❌ GENERIC B2B TEST FAILED:', err);
    process.exit(1);
});
