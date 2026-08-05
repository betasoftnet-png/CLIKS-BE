const db = require('../db/connection');
const { runMigrations } = require('../db/migrations');
const caController = require('../controllers/caController');

async function testPhase2FullWorkflow() {
    console.log('====================================================');
    console.log('  STARTING PHASE 2 FULL WORKFLOW AUDIT & VERIFICATION');
    console.log('====================================================');

    await runMigrations();

    const now = new Date().toISOString();
    
    // 1. Business Owner User
    let owner = await db.prepare("SELECT * FROM users WHERE email = 'owner.phase2@cliks.com'").get();
    if (!owner) {
        const res = await db.prepare(`
            INSERT INTO users (username, email, password_hash, role, business_name, is_online, created_at)
            VALUES ('Zenith Owner', 'owner.phase2@cliks.com', 'hash123', 'business', 'Zenith Ltd', 1, ?)
        `).run(now);
        owner = { id: res.lastInsertRowid, username: 'Zenith Owner', email: 'owner.phase2@cliks.com', role: 'business' };
    }

    // 2. CA Advisor User
    let ca = await db.prepare("SELECT * FROM users WHERE email = 'ca.phase2@cliks.com'").get();
    if (!ca) {
        const res = await db.prepare(`
            INSERT INTO users (username, email, password_hash, role, business_name, is_online, created_at)
            VALUES ('CA Mehta', 'ca.phase2@cliks.com', 'hash123', 'ca', 'Mehta & Associates', 1, ?)
        `).run(now);
        ca = { id: res.lastInsertRowid, username: 'CA Mehta', email: 'ca.phase2@cliks.com', role: 'ca' };
    }

    // 3. Connected Client Record
    let client = await db.prepare("SELECT * FROM ca_clients WHERE ca_user_id = ? AND business_owner_id = ?").get(ca.id, owner.id);
    if (!client) {
        const res = await db.prepare(`
            INSERT INTO ca_clients (ca_user_id, business_owner_id, name, email, regime, income, pending_filings, status)
            VALUES (?, ?, 'Zenith Ltd', 'owner.phase2@cliks.com', 'New', 5000000, 0, 'Active')
        `).run(ca.id, owner.id);
        client = { id: res.lastInsertRowid, name: 'Zenith Ltd', email: 'owner.phase2@cliks.com' };
    }

    const mockRes = () => {
        const res = {};
        res.status = (code) => { res.statusCode = code; return res; };
        res.json = (data) => { res.body = data; return res; };
        res.setHeader = () => {};
        res.send = (html) => { res.body = html; return res; };
        return res;
    };

    const reqOwner = { user: owner, body: {}, params: {}, query: {} };
    const reqCA = { user: ca, body: {}, params: {}, query: {} };

    console.log(`\n🔹 Module 1: Time Tracking — CA starts & stops Audit Session (35 Mins = 2100 Seconds)...`);
    reqCA.body = {
        clientId: client.id,
        durationSeconds: 2100, // 35 Mins -> CEILING(35/10)*100 = 4 * 100 = ₹400
        auditDate: new Date().toISOString().split('T')[0]
    };
    let res = mockRes();
    await caController.addAuditSession(reqCA, res);
    const session = res.body?.data;
    console.log(`   -> Audit Session Saved (ID: ${session?.id}, Session ID: ${session?.sessionId}, Duration: 35 mins)`);

    console.log(`\n🔹 Module 2 & 3: Professional Billing & Invoice Generation...`);
    reqCA.body = {
        sessionId: session?.id,
        clientId: client.id,
        invoiceDate: new Date().toISOString().split('T')[0]
    };
    res = mockRes();
    await caController.generateProfessionalInvoice(reqCA, res);
    const inv = res.body?.data;
    console.log(`   -> Invoice Number: ${inv?.invoiceNumber}`);
    console.log(`   -> Professional Fee (Calculated 35 mins @ ₹100/10m): ₹${inv?.amount}`);
    console.log(`   -> GST (18%): ₹${inv?.gstAmount}`);
    console.log(`   -> Grand Total: ₹${inv?.totalAmount}`);
    console.log(`   -> Invoice Status: ${inv?.status}`);

    console.log(`\n🔹 Module 4: PDF Invoice Generation & Viewing...`);
    reqOwner.params = { id: inv?.id };
    res = mockRes();
    await caController.getProfessionalInvoicePdf(reqOwner, res);
    const hasHtml = typeof res.body === 'string' && res.body.includes('CLIKS FIN-PRO AUDIT INVOICE');
    console.log(`   -> Generated HTML/PDF invoice output verified? ${hasHtml}`);

    console.log(`\n🔹 Module 5: Payment Process — Business Owner pays invoice via UPI...`);
    reqOwner.params = { id: inv?.id };
    reqOwner.body = { paymentMethod: 'UPI' };
    res = mockRes();
    await caController.payInvoice(reqOwner, res);
    const payRes = res.body?.data;
    console.log(`   -> Payment Success (Payment ID: ${payRes?.paymentId}, Txn Ref: ${payRes?.transactionId}, Method: ${payRes?.paymentMethod})`);

    console.log(`\n🔹 Module 6: Payment History Verification...`);
    reqOwner.params = {};
    reqOwner.body = {};
    res = mockRes();
    await caController.getPaymentHistory(reqOwner, res);
    const ownerPayHistory = res.body?.data || [];
    console.log(`   -> Business Owner Payment History Records: ${ownerPayHistory.length}`);
    console.log(`      Latest Payment: Invoice ${ownerPayHistory[0]?.invoiceNumber}, Amount ₹${ownerPayHistory[0]?.amount}, Method ${ownerPayHistory[0]?.paymentMethod}`);

    console.log(`\n🔹 Module 7: Monthly Earnings Dashboard Verification...`);
    res = mockRes();
    await caController.getEarningsDashboard(reqCA, res);
    const earnings = res.body?.data;
    console.log(`   -> CA Earnings Dashboard Metrics:`);
    console.log(`      Total Revenue: ₹${earnings?.totalRevenue}`);
    console.log(`      Paid Revenue: ₹${earnings?.paid}`);
    console.log(`      Pending Revenue: ₹${earnings?.pending}`);
    console.log(`      Total Audit Hours: ${earnings?.totalAuditHours} hrs`);
    console.log(`      Avg Billing / Client: ₹${earnings?.averageBillingPerClient}`);

    console.log(`\n====================================================`);
    console.log(`  VERIFYING PHASE 2 NOTIFICATIONS CREATED IN DATABASE`);
    console.log(`====================================================`);
    const notifs = await db.prepare(`
        SELECT id, sender_id, receiver_id, type, title, message, created_at 
        FROM notifications 
        ORDER BY id DESC LIMIT 10
    `).all();
    console.table(notifs);

    console.log(`\n====================================================`);
    console.log(`  FINAL DATABASE ROW COUNTS`);
    console.log(`====================================================`);
    const counts = {
        ca_audit_sessions: (await db.prepare('SELECT count(*) as c FROM ca_audit_sessions').get()).c,
        audit_sessions_view: (await db.prepare('SELECT count(*) as c FROM audit_sessions').get()).c,
        ca_professional_invoices: (await db.prepare('SELECT count(*) as c FROM ca_professional_invoices').get()).c,
        invoice_items: (await db.prepare('SELECT count(*) as c FROM invoice_items').get()).c,
        ca_payments: (await db.prepare('SELECT count(*) as c FROM ca_payments').get()).c,
        payment_history_view: (await db.prepare('SELECT count(*) as c FROM payment_history').get()).c,
        notifications: (await db.prepare('SELECT count(*) as c FROM notifications').get()).c
    };
    console.log(JSON.stringify(counts, null, 2));

    process.exit(0);
}

testPhase2FullWorkflow().catch(err => {
    console.error('Phase 2 Workflow Test Failed:', err);
    process.exit(1);
});
