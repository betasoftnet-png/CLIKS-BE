const db = require('../db/connection');
const { runMigrations } = require('../db/migrations');
const caController = require('../controllers/caController');

async function testAuditSessionSaveFlow() {
    console.log('====================================================');
    console.log('  TESTING AUDIT SESSION SAVE & AUTOMATIC BILLING');
    console.log('====================================================');

    await runMigrations();

    const now = new Date().toISOString();

    // 1. Setup Business Owner (sanjay123)
    let owner = await db.prepare("SELECT * FROM users WHERE email = 'sanjay123@bnxmail.com'").get();
    if (!owner) {
        const res = await db.prepare(`
            INSERT INTO users (username, email, password_hash, role, created_at)
            VALUES ('sanjay123', 'sanjay123@bnxmail.com', 'hash123', 'business', ?)
        `).run(now);
        owner = { id: res.lastInsertRowid, username: 'sanjay123', email: 'sanjay123@bnxmail.com' };
    }

    // 2. Setup CA (dineshkumar123)
    let ca = await db.prepare("SELECT * FROM users WHERE email = 'dineshkumar123@bnxmail.com'").get();
    if (!ca) {
        const res = await db.prepare(`
            INSERT INTO users (username, email, password_hash, role, created_at)
            VALUES ('dineshkumar123', 'dineshkumar123@bnxmail.com', 'hash123', 'ca', ?)
        `).run(now);
        ca = { id: res.lastInsertRowid, username: 'dineshkumar123', email: 'dineshkumar123@bnxmail.com' };
    }

    // 3. Setup ca_clients link
    let client = await db.prepare("SELECT * FROM ca_clients WHERE ca_user_id = ? AND email = ?").get(ca.id, owner.email);
    if (!client) {
        const res = await db.prepare(`
            INSERT INTO ca_clients (ca_user_id, business_owner_id, name, email, status)
            VALUES (?, ?, 'sanjay123', 'sanjay123@bnxmail.com', 'Active')
        `).run(ca.id, owner.id);
        client = { id: res.lastInsertRowid, business_owner_id: owner.id, email: owner.email };
    }

    const mockRes = () => {
        const res = {};
        res.status = (code) => { res.statusCode = code; return res; };
        res.json = (data) => { res.body = data; return res; };
        return res;
    };

    const reqCA = { user: ca, body: {}, params: {}, query: {} };
    const reqOwner = { user: owner, body: {}, params: {}, query: {} };

    console.log(`\nSetup:\n - CA User ID: ${ca.id}\n - Business Owner ID: ${owner.id}\n - Client Name: 'sanjay123'`);

    console.log('\nSTEP 1: CA clicks Stop & Save for 33m 15s session...');
    reqCA.body = {
        clientId: 'sanjay123', // passing string client name from UI dropdown
        startTime: new Date(Date.now() - 1995 * 1000).toISOString(),
        stopTime: new Date().toISOString(),
        durationSeconds: 1995, // 33m 15s
        auditDate: '2026-08-05',
        auditDescription: 'Review GST Bill & Filing',
        hourlyRate: 500
    };

    let res = mockRes();
    await caController.addAuditSession(reqCA, res);

    if (res.statusCode && res.statusCode !== 200) {
        console.error('❌ Failed to save audit session:', res.body);
        process.exit(1);
    }

    const savedData = res.body?.data;
    console.log(' ✅ Audit Session Saved Successfully!');
    console.log('   - Session ID:', savedData.sessionId);
    console.log('   - Invoice Number:', savedData.invoiceNumber);
    console.log('   - Duration Text:', savedData.durationText);
    console.log('   - Professional Fee:', savedData.professionalFee);
    console.log('   - GST Amount (18%):', savedData.gstAmount);
    console.log('   - Grand Total:', savedData.grandTotal);

    console.log('\nSTEP 2: Verify Audit Sessions Table...');
    const auditSessInDb = await db.prepare("SELECT * FROM ca_audit_sessions WHERE session_id = ?").get(savedData.sessionId);
    console.log(' -> Audit Session in DB:', auditSessInDb ? 'EXISTS' : 'MISSING');

    console.log('\nSTEP 3: Verify Professional Services Table...');
    const serviceInDb = await db.prepare("SELECT * FROM ca_professional_services WHERE audit_session_id = ?").get(savedData.id);
    console.log(' -> Professional Service in DB:', serviceInDb ? 'EXISTS' : 'MISSING');

    console.log('\nSTEP 4: Verify Professional Invoices Table...');
    const invoiceInDb = await db.prepare("SELECT * FROM ca_professional_invoices WHERE invoice_number = ?").get(savedData.invoiceNumber);
    console.log(' -> Professional Invoice in DB:', invoiceInDb ? 'EXISTS' : 'MISSING', 'Status:', invoiceInDb?.status);

    console.log('\nSTEP 5: Business Owner fetches Professional Invoices on Dashboard...');
    res = mockRes();
    await caController.getProfessionalInvoices(reqOwner, res);
    const ownerInvoices = res.body?.data || [];
    console.log(` -> Business Owner dashboard received ${ownerInvoices.length} invoice(s).`);
    console.log(` -> Latest Invoice: "${ownerInvoices[0]?.invoice_number}" for ₹${ownerInvoices[0]?.total_amount || ownerInvoices[0]?.amount} (${ownerInvoices[0]?.audit_description}) Status: "${ownerInvoices[0]?.status}"`);

    if (auditSessInDb && serviceInDb && invoiceInDb && ownerInvoices.length > 0) {
        console.log('\n====================================================');
        console.log('  AUDIT SESSION SAVE & AUTOMATIC BILLING PASSED!  ');
        console.log('====================================================');
        process.exit(0);
    } else {
        console.error('❌ Mismatch or missing DB records');
        process.exit(1);
    }
}

testAuditSessionSaveFlow().catch(err => {
    console.error('Audit Save Test Failed:', err);
    process.exit(1);
});
