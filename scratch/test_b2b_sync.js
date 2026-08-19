const db = require('../db/connection');
const b2bConnectionService = require('../utils/b2bConnectionService');
const supplierController = require('../controllers/supplierController');
const customerController = require('../controllers/customerController');

async function testB2BSyncWorkflow() {
    console.log('=== STARTING B2B CONNECTION & INVOICE SYNC WORKFLOW TEST ===\n');

    const now = new Date().toISOString();

    // 1. Ensure user accounts exist for Ravi and Sanjay
    let ravi = await db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get('raviram2004@bnxmail.com');
    if (!ravi) {
        const res = await db.prepare(`
            INSERT INTO users (username, email, password_hash, business_name, created_at, updated_at)
            VALUES ('Ravi Ram', 'raviram2004@bnxmail.com', 'hash123', 'Ravi Enterprises', ?, ?)
        `).run(now, now);
        ravi = await db.prepare('SELECT * FROM users WHERE id = ?').get(res.lastInsertRowid || res.id);
    }

    let sanjay = await db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get('sanjay123@bnxmail.com');
    if (!sanjay) {
        const res = await db.prepare(`
            INSERT INTO users (username, email, password_hash, business_name, created_at, updated_at)
            VALUES ('Sanjay Kumar', 'sanjay123@bnxmail.com', 'hash123', 'Sanjay Wholesale', ?, ?)
        `).run(now, now);
        sanjay = await db.prepare('SELECT * FROM users WHERE id = ?').get(res.lastInsertRowid || res.id);
    }

    console.log(`✓ Account A: ${ravi.username} (${ravi.email}, ID: ${ravi.id})`);
    console.log(`✓ Account B: ${sanjay.username} (${sanjay.email}, ID: ${sanjay.id})\n`);

    await b2bConnectionService.ensureTable();

    // Clean old test data for idempotent test run
    await db.prepare('DELETE FROM b2b_connections WHERE (requester_user_id = ? AND target_user_id = ?) OR (requester_user_id = ? AND target_user_id = ?)').run(ravi.id, sanjay.id, sanjay.id, ravi.id);
    await db.prepare('DELETE FROM b2b_invoice_relationships WHERE buyer_user_id = ? AND supplier_user_id = ?').run(ravi.id, sanjay.id);

    // STEP 1: Ravi adds Sanjay as Supplier
    console.log('--- Step 1: Ravi adds Sanjay as Supplier ---');
    const b2bConn = await b2bConnectionService.createOrUpdateConnection({
        requester_user_id: ravi.id,
        supplier_email: sanjay.email,
        supplier_name: sanjay.business_name || sanjay.username
    });

    console.log('Created Connection:', {
        id: b2bConn.id,
        requester: b2bConn.requester_email,
        target: b2bConn.target_email,
        status: b2bConn.status
    });

    if (b2bConn.status !== 'PENDING') throw new Error('Expected status to be PENDING');
    console.log('✓ Connection request status is PENDING\n');

    // STEP 2: Sanjay sees Pending Request in Customers
    console.log('--- Step 2: Sanjay fetches Customers List ---');
    const sanjayConns = await b2bConnectionService.getConnectionsForUser(sanjay.id);
    const pendingReq = sanjayConns.find(c => c.id === b2bConn.id);
    console.log('Sanjay Pending Request:', pendingReq ? `ID #${pendingReq.id} from ${pendingReq.requester_email} (${pendingReq.status})` : 'NOT FOUND');
    if (!pendingReq || pendingReq.status !== 'PENDING') throw new Error('Sanjay should see pending request');
    console.log('✓ Sanjay sees pending request from Ravi\n');

    // STEP 3: Sanjay accepts connection
    console.log('--- Step 3: Sanjay accepts connection ---');
    const acceptedConn = await b2bConnectionService.respondToConnection({
        user_id: sanjay.id,
        connection_id: b2bConn.id,
        action: 'ACCEPT'
    });
    console.log('Accepted Connection Status:', acceptedConn.status);
    if (acceptedConn.status !== 'ACCEPTED') throw new Error('Expected ACCEPTED status');
    console.log('✓ Connection accepted successfully\n');

    // STEP 4 & 5: Check Connected status on both sides
    console.log('--- Step 4 & 5: Verifying Connected status on both accounts ---');
    const sanjayCustRow = await db.prepare('SELECT * FROM business_customers WHERE user_id = ? AND LOWER(email) = ?').get(sanjay.id, ravi.email.toLowerCase());
    console.log("Sanjay's Customers list entry for Ravi:", sanjayCustRow ? `${sanjayCustRow.name} - Status: ${sanjayCustRow.status}` : 'Not found');

    const raviSuppRow = await db.prepare('SELECT * FROM business_suppliers WHERE user_id = ? AND LOWER(email) = ?').get(ravi.id, sanjay.email.toLowerCase());
    console.log("Ravi's Suppliers list entry for Sanjay:", raviSuppRow ? `${raviSuppRow.name} - Status: ${raviSuppRow.status}` : 'Not found');

    if (!sanjayCustRow || sanjayCustRow.status !== 'Connected') throw new Error('Ravi should be Connected customer for Sanjay');
    if (!raviSuppRow || raviSuppRow.status !== 'CONNECTED') throw new Error('Sanjay should be Connected supplier for Ravi');
    console.log('✓ Both accounts show Connected status\n');

    // STEP 6 & 7: Ravi creates Purchase Invoice against Sanjay
    console.log('--- Step 6 & 7: Ravi creates Purchase Invoice ---');
    const poNum = `PO-TEST-${Date.now().toString().slice(-4)}`;
    const items = [
        { product_name: 'Apple Gold', sku: 'APL-100', quantity: 10, purchase_price: 500, price: 500, tax_amount: 900, total: 5900 }
    ];

    const purRes = await db.prepare(`
        INSERT INTO business_purchases (
            user_id, purchase_number, purchase_type, purchase_date, due_date, doc_type, status,
            supplier_name, supplier_gstin, payment_status, payment_mode,
            subtotal, total_discount, total_tax, grand_total, created_at, updated_at
        ) VALUES (?, ?, 'GST', ?, ?, 'PO', 'Approved', ?, '27AAAAA0000A1Z5', 'pending', 'Credit', 5000, 0, 900, 5900, ?, ?)
    `).run(ravi.id, poNum, now.split('T')[0], now.split('T')[0], sanjay.business_name, now, now);

    const purchaseId = purRes.lastInsertRowid || purRes.id;

    // Trigger B2B Purchase-to-Sales Invoice Auto Sync
    const syncResult = await b2bConnectionService.syncPurchaseToSalesInvoice({
        purchaseId: purchaseId,
        userId: ravi.id,
        supplierEmail: sanjay.email,
        purchaseData: {
            purchase_number: poNum,
            subtotal: 5000,
            total_tax: 900,
            total_discount: 0,
            grand_total: 5900,
            payment_status: 'pending',
            payment_mode: 'Credit',
            due_date: now.split('T')[0],
            items: items
        }
    });

    console.log('Sync Result:', syncResult);
    if (!syncResult || !syncResult.salesInvoiceId) throw new Error('Sales invoice was not auto-created');
    console.log('✓ Sales invoice auto-created in Sanjay\'s account ID:', syncResult.salesInvoiceId, '\n');

    // STEP 8: Verify Sales Invoice in Sanjay's account
    console.log('--- Step 8: Sanjay views Sales Invoice ---');
    const sanjaySalesInv = await db.prepare('SELECT * FROM business_invoices WHERE id = ?').get(syncResult.salesInvoiceId);
    console.log('Sales Invoice Details:', {
        id: sanjaySalesInv.id,
        invoice_number: sanjaySalesInv.invoice_number,
        client_name: sanjaySalesInv.client_name,
        client_email: sanjaySalesInv.client_email,
        total_amount: sanjaySalesInv.total_amount,
        notes: sanjaySalesInv.notes
    });

    if (sanjaySalesInv.client_email !== ravi.email) throw new Error('Sales invoice client email should match Ravi');
    if (!sanjaySalesInv.notes.includes('Source: Purchase Invoice')) throw new Error('Notes should reference source purchase invoice');
    console.log('✓ Sales Invoice details match Purchase Invoice created by Ravi\n');

    // STEP 9: Verify Idempotency (prevent duplicate creation on retry)
    console.log('--- Step 9: Testing Idempotency (retry sync) ---');
    const retryResult = await b2bConnectionService.syncPurchaseToSalesInvoice({
        purchaseId: purchaseId,
        userId: ravi.id,
        supplierEmail: sanjay.email,
        purchaseData: {
            purchase_number: poNum,
            subtotal: 5000,
            total_tax: 900,
            total_discount: 0,
            grand_total: 5900,
            payment_status: 'pending',
            items: items
        }
    });

    console.log('Retry Sync Result:', retryResult);
    const invoiceCount = await db.prepare('SELECT count(*) as count FROM b2b_invoice_relationships WHERE source_purchase_invoice_id = ?').get(purchaseId);
    console.log('Relationship records count for PO:', invoiceCount.count);
    if (invoiceCount.count !== 1) throw new Error('Expected exactly 1 relationship record (no duplicates)');
    console.log('✓ Idempotency verified: NO duplicate Sales Invoices created on retry!\n');

    console.log('=== ALL 9 B2B WORKFLOW TESTS PASSED SUCCESSFULLY! ===');
}

testB2BSyncWorkflow().catch(err => {
    console.error('❌ TEST FAILED:', err);
    process.exit(1);
});
