const db = require('../db/connection');
const { runMigrations } = require('../db/migrations');
const customerController = require('../controllers/customerController');
const vendorController = require('../controllers/vendorController');
const bankAccountController = require('../controllers/bankAccountController');
const reportsController = require('../controllers/reportsController');
const auditLogController = require('../controllers/auditLogController');
const documentController = require('../controllers/documentController');

async function testPhase3FullWorkflow() {
    console.log('====================================================');
    console.log('  STARTING PHASE 3 FULL WORKFLOW AUDIT & VERIFICATION');
    console.log('====================================================');

    await runMigrations();

    const now = new Date().toISOString();

    // Setup Test Business Owner
    let owner = await db.prepare("SELECT * FROM users WHERE email = 'owner.phase3@cliks.com'").get();
    if (!owner) {
        const res = await db.prepare(`
            INSERT INTO users (username, email, password_hash, role, business_name, is_online, created_at)
            VALUES ('Phase3 Business Owner', 'owner.phase3@cliks.com', 'hash123', 'business', 'Enterprise Phase 3 Ltd', 1, ?)
        `).run(now);
        owner = { id: res.lastInsertRowid, username: 'Phase3 Business Owner', email: 'owner.phase3@cliks.com', role: 'business' };
    }

    // Setup Test CA Advisor
    let ca = await db.prepare("SELECT * FROM users WHERE email = 'ca.phase3@cliks.com'").get();
    if (!ca) {
        const res = await db.prepare(`
            INSERT INTO users (username, email, password_hash, role, business_name, is_online, created_at)
            VALUES ('Phase3 CA Advisor', 'ca.phase3@cliks.com', 'hash123', 'ca', 'Phase3 Financial Advisors', 1, ?)
        `).run(now);
        ca = { id: res.lastInsertRowid, username: 'Phase3 CA Advisor', email: 'ca.phase3@cliks.com', role: 'ca' };
    }

    const mockRes = () => {
        const res = {};
        res.status = (code) => { res.statusCode = code; return res; };
        res.json = (data) => { res.body = data; return res; };
        res.setHeader = () => {};
        res.send = (html) => { res.body = html; return res; };
        return res;
    };

    const reqOwner = { user: owner, body: {}, params: {}, query: {}, ip: '127.0.0.1', headers: { 'user-agent': 'Phase3-TestAgent' } };
    const reqCA = { user: ca, body: {}, params: {}, query: {}, ip: '127.0.0.1', headers: { 'user-agent': 'Phase3-TestAgent' } };

    console.log(`\n🔹 Module 1: Customers Module — Create, Read, Update, Filter & Pagination...`);
    reqOwner.body = {
        name: 'Apex Retailers',
        company: 'Apex Retail Pvt Ltd',
        gstin: '27AAAAA0000A1Z5',
        pan: 'AAAAA0000A',
        email: 'billing@apexretail.com',
        phone: '+91 9820012345',
        address: '101 Trade Center, BKC',
        state: 'Maharashtra',
        country: 'India',
        openingBalance: 50000,
        creditLimit: 200000,
        status: 'Active'
    };
    let res = mockRes();
    await customerController.createCustomer(reqOwner, res);
    const customer = res.body?.data;
    console.log(`   -> Created Customer ID: ${customer?.id}, Name: ${customer?.name}, Company: ${customer?.company}`);

    reqOwner.query = { q: 'Apex', page: 1, limit: 10 };
    res = mockRes();
    await customerController.getCustomers(reqOwner, res);
    console.log(`   -> Fetched Customer List Count: ${res.body?.data?.customers?.length}, Total: ${res.body?.data?.pagination?.total}`);

    console.log(`\n🔹 Module 2: Vendors Module — Create, Read, Update & Filter...`);
    reqOwner.body = {
        name: 'Global Metal Supplies',
        gstin: '27BBBBB1111B1Z2',
        pan: 'BBBBB1111B',
        email: 'orders@globalmetals.com',
        phone: '+91 9821198765',
        address: 'Plot 45, Industrial Area, Thane',
        bankDetails: { bank: 'HDFC Bank', account: '5010099887766', ifsc: 'HDFC0000123' },
        openingBalance: 120000,
        status: 'Active'
    };
    res = mockRes();
    await vendorController.createVendor(reqOwner, res);
    const vendor = res.body?.data;
    console.log(`   -> Created Vendor ID: ${vendor?.id}, Name: ${vendor?.name}`);

    reqOwner.query = { q: 'Global' };
    res = mockRes();
    await vendorController.getVendors(reqOwner, res);
    console.log(`   -> Fetched Vendor List Count: ${res.body?.data?.vendors?.length}`);

    console.log(`\n🔹 Module 3: Bank Accounts Module — Create, Balance Credit/Debit Update...`);
    reqOwner.body = {
        bankName: 'HDFC Current Account',
        accountHolder: 'Enterprise Phase 3 Ltd',
        accountNumber: '50100445566778',
        ifsc: 'HDFC0000555',
        branch: 'Fort Mumbai',
        upiId: 'enterprise3@hdfcbank',
        openingBalance: 2500000
    };
    res = mockRes();
    await bankAccountController.createBankAccount(reqOwner, res);
    const bankAcc = res.body?.data;
    console.log(`   -> Created Bank Account ID: ${bankAcc?.id}, Bank: ${bankAcc?.bank_name}, Opening Bal: ₹${bankAcc?.opening_balance}`);

    // Update balance
    reqOwner.params = { id: bankAcc?.id };
    reqOwner.body = { amount: 50000, type: 'credit', description: 'Customer Invoice Receipt' };
    res = mockRes();
    await bankAccountController.updateBalance(reqOwner, res);
    const updatedBank = res.body?.data;
    console.log(`   -> Updated Bank Current Balance: ₹${updatedBank?.current_balance}`);

    console.log(`\n🔹 Module 4: Reports Engine — P&L, Balance Sheet, GST, TDS, Ledgers & PDF Export...`);
    reqOwner.params = {};
    reqOwner.query = {};
    res = mockRes();
    await reportsController.getProfitLoss(reqOwner, res);
    console.log(`   -> P&L Gross Revenue: ₹${res.body?.data?.gross_revenue}, Net Profit: ₹${res.body?.data?.net_profit}`);

    res = mockRes();
    await reportsController.getBalanceSheet(reqOwner, res);
    console.log(`   -> Balance Sheet Assets Cash: ₹${res.body?.data?.assets?.cash}, Receivables: ₹${res.body?.data?.assets?.receivables}`);

    reqOwner.query = { type: 'Profit & Loss' };
    res = mockRes();
    await reportsController.exportPdf(reqOwner, res);
    console.log(`   -> PDF Report Export URL: ${res.body?.data?.download_url}`);

    console.log(`\n🔹 Module 5: Audit Logs — Verification of Auto-Logged Events...`);
    res = mockRes();
    await auditLogController.getAuditLogs(reqOwner, res);
    const auditLogs = res.body?.data?.logs || [];
    console.log(`   -> Fetched Audit Logs Count: ${auditLogs.length}`);
    console.log(`      Latest Audit Action: "${auditLogs[0]?.action}" on Module "${auditLogs[0]?.module}" by ${auditLogs[0]?.actor}`);

    console.log(`\n🔹 Module 6: Document Management — Metadata & Status Review...`);
    reqOwner.body = {
        name: 'Q3_GST_Filing_Backup.pdf',
        category: 'Tax Filing',
        filePath: '/uploads/Q3_GST_Filing_Backup.pdf',
        caId: ca.id,
        remarks: 'Uploaded for CA quarterly audit review'
    };
    res = mockRes();
    await documentController.createDocument(reqOwner, res);
    const doc = res.body?.data;
    console.log(`   -> Created Document ID: ${doc?.id}, Name: ${doc?.name}, Version: V${doc?.version}`);

    console.log(`\n====================================================`);
    console.log(`  VERIFYING PHASE 3 DATABASE ROW COUNTS`);
    console.log(`====================================================`);
    const counts = {
        business_customers: (await db.prepare('SELECT count(*) as c FROM business_customers').get()).c,
        customers_view: (await db.prepare('SELECT count(*) as c FROM customers').get()).c,
        vendors: (await db.prepare('SELECT count(*) as c FROM vendors').get()).c,
        bank_accounts: (await db.prepare('SELECT count(*) as c FROM bank_accounts').get()).c,
        documents: (await db.prepare('SELECT count(*) as c FROM documents').get()).c,
        audit_logs: (await db.prepare('SELECT count(*) as c FROM audit_logs').get()).c
    };
    console.log(JSON.stringify(counts, null, 2));

    process.exit(0);
}

testPhase3FullWorkflow().catch(err => {
    console.error('Phase 3 Workflow Test Failed:', err);
    process.exit(1);
});
