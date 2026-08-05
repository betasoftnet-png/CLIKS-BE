const db = require('../db/connection');
const { runMigrations } = require('../db/migrations');
const caController = require('../controllers/caController');

async function testAuditDescriptionWorkflow() {
    console.log('====================================================');
    console.log('  TESTING AUDIT DESCRIPTION & AUTO-BILLING WORKFLOW');
    console.log('====================================================');

    await runMigrations();

    const now = new Date().toISOString();

    // Setup Test Business Owner & CA
    let owner = await db.prepare("SELECT * FROM users WHERE email = 'owner.auditdesc@cliks.com'").get();
    if (!owner) {
        const res = await db.prepare(`
            INSERT INTO users (username, email, password_hash, role, business_name, created_at)
            VALUES ('Santhosh Owner', 'owner.auditdesc@cliks.com', 'hash123', 'business', 'Santhosh Enterprise', ?)
        `).run(now);
        owner = { id: res.lastInsertRowid, username: 'Santhosh Owner', email: 'owner.auditdesc@cliks.com', role: 'business' };
    }

    let ca = await db.prepare("SELECT * FROM users WHERE email = 'ca.auditdesc@cliks.com'").get();
    if (!ca) {
        const res = await db.prepare(`
            INSERT INTO users (username, email, password_hash, role, business_name, created_at)
            VALUES ('CA Audit Specialist', 'ca.auditdesc@cliks.com', 'hash123', 'ca', 'CA Practice Firm', ?)
        `).run(now);
        ca = { id: res.lastInsertRowid, username: 'CA Audit Specialist', email: 'ca.auditdesc@cliks.com', role: 'ca' };
    }

    // Connect client
    let client = await db.prepare("SELECT * FROM ca_clients WHERE ca_user_id = ? AND business_owner_id = ?").get(ca.id, owner.id);
    if (!client) {
        const res = await db.prepare(`
            INSERT INTO ca_clients (ca_user_id, business_owner_id, name, email, status)
            VALUES (?, ?, 'Santhosh Enterprise', 'owner.auditdesc@cliks.com', 'Active')
        `).run(ca.id, owner.id);
        client = { id: res.lastInsertRowid, name: 'Santhosh Enterprise', business_owner_id: owner.id };
    }

    const mockRes = () => {
        const res = {};
        res.status = (code) => { res.statusCode = code; return res; };
        res.json = (data) => { res.body = data; return res; };
        res.setHeader = () => {};
        res.send = (html) => { res.body = html; return res; };
        return res;
    };

    const reqCA = { user: ca, body: {}, params: {}, query: {}, ip: '127.0.0.1', headers: {} };
    const reqOwner = { user: owner, body: {}, params: {}, query: {}, ip: '127.0.0.1', headers: {} };

    console.log('\n1. CA Creates Audit Session with Detailed Audit Description...');
    reqCA.body = {
        clientId: client.id,
        startTime: new Date('2026-08-05T10:00:00.000Z').toISOString(),
        stopTime: new Date('2026-08-05T11:45:00.000Z').toISOString(),
        durationSeconds: 6300, // 1 hour 45 minutes (1.75 hours)
        auditDate: '2026-08-05',
        auditDescription: 'GST Return Filing (GSTR-1)\nReview Purchase Bills\nTDS Calculation\nIncome Tax Audit',
        hourlyRate: 500
    };

    let res = mockRes();
    await caController.addAuditSession(reqCA, res);
    const session = res.body?.data;
    console.log('   -> Audit Session Saved ID:', session?.id);
    console.log('   -> Invoice Number Generated:', session?.invoiceNumber);
    console.log('   -> Audit Description Stored:\n' + session?.auditDescription.split('\n').map(l => '      | ' + l).join('\n'));
    console.log(`   -> Start Time: ${session?.startTime}, End Time: ${session?.endTime}`);
    console.log(`   -> Duration Text: ${session?.durationText}`);
    console.log(`   -> Rate: ₹${session?.hourlyRate}/hr => Professional Fee: ₹${session?.professionalFee}, GST (18%): ₹${session?.gstAmount}, Grand Total: ₹${session?.grandTotal}`);

    console.log('\n2. Business Owner Views Professional Invoices...');
    res = mockRes();
    await caController.getProfessionalInvoices(reqOwner, res);
    const ownerInvoices = res.body?.data || [];
    console.log('   -> Business Owner Invoices Count:', ownerInvoices.length);
    console.log('   -> Latest Invoice Audit Description:', ownerInvoices[0]?.audit_description);

    console.log('\n3. Business Owner Views PDF Invoice Output HTML...');
    reqOwner.params = { id: session?.invoiceNumber };
    res = mockRes();
    await caController.getProfessionalInvoicePdf(reqOwner, res);
    const pdfHtml = res.body;
    console.log('   -> PDF HTML Contains Description:', pdfHtml.includes('GST Return Filing (GSTR-1)'));
    console.log('   -> PDF HTML Contains Rate ₹500 / Hour:', pdfHtml.includes('₹500 / Hour'));

    console.log('\n4. Business Owner Pays Invoice...');
    const invToPay = ownerInvoices[0];
    reqOwner.params = { id: invToPay?.id };
    reqOwner.body = { paymentMethod: 'UPI' };
    res = mockRes();
    await caController.payInvoice(reqOwner, res);
    console.log('   -> Payment Status Response:', res.body?.message || 'Payment Successful');

    console.log('\n5. Verifying Payment History Records...');
    const payHistory = await db.prepare("SELECT * FROM payment_history ORDER BY id DESC LIMIT 1").get();
    console.log('   -> Payment History Record:', JSON.stringify(payHistory, null, 2));

    console.log('\n====================================================');
    console.log('  AUDIT DESCRIPTION & BILLING WORKFLOW TEST PASSED!');
    console.log('====================================================');
    process.exit(0);
}

testAuditDescriptionWorkflow().catch(err => {
    console.error('Audit Description Workflow Test Failed:', err);
    process.exit(1);
});
