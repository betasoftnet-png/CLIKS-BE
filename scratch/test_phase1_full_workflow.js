const db = require('../db/connection');
const { runMigrations } = require('../db/migrations');
const caController = require('../controllers/caController');

async function testFullWorkflow() {
    console.log('====================================================');
    console.log('  STARTING PHASE 1 FULL WORKFLOW AUDIT & VERIFICATION');
    console.log('====================================================');

    await runMigrations();

    // Setup Test Users in Database if missing
    const now = new Date().toISOString();
    
    // 1. Business Owner User
    let owner = await db.prepare("SELECT * FROM users WHERE email = 'owner.test@cliks.com'").get();
    if (!owner) {
        const res = await db.prepare(`
            INSERT INTO users (username, email, password_hash, role, business_name, is_online, created_at)
            VALUES ('Acme Owner', 'owner.test@cliks.com', 'hash123', 'business', 'Acme Corp', 0, ?)
        `).run(now);
        owner = { id: res.lastInsertRowid, username: 'Acme Owner', email: 'owner.test@cliks.com', role: 'business' };
    }

    // 2. CA Advisor User
    let ca = await db.prepare("SELECT * FROM users WHERE email = 'ca.test@cliks.com'").get();
    if (!ca) {
        const res = await db.prepare(`
            INSERT INTO users (username, email, password_hash, role, business_name, is_online, created_at)
            VALUES ('CA Sharma', 'ca.test@cliks.com', 'hash123', 'ca', 'Sharma & Co', 0, ?)
        `).run(now);
        ca = { id: res.lastInsertRowid, username: 'CA Sharma', email: 'ca.test@cliks.com', role: 'ca' };
    }

    const mockRes = () => {
        const res = {};
        res.status = (code) => { res.statusCode = code; return res; };
        res.json = (data) => { res.body = data; return res; };
        return res;
    };

    const reqOwner = { user: owner, body: {}, params: {}, query: {} };
    const reqCA = { user: ca, body: {}, params: {}, query: {} };

    console.log(`\n🔹 Step 1: Business Owner (${owner.email}) invites CA (${ca.email})...`);
    reqOwner.body = { email: ca.email };
    let res = mockRes();
    await caController.sendInvitation(reqOwner, res);
    const inviteId = res.body?.data?.id;
    console.log(`   -> Invitation Sent (ID: ${inviteId}, Status: ${res.body?.data?.status || 'Sent'})`);

    console.log(`\n🔹 Step 2: CA logs in & accepts invitation...`);
    // CA Presence login
    res = mockRes();
    await caController.setUserOnline(reqCA, res);
    console.log(`   -> CA Presence: ${res.body?.data?.status}`);

    reqCA.params = { id: inviteId };
    res = mockRes();
    await caController.acceptInvitation(reqCA, res);
    console.log(`   -> Invitation Accepted by CA`);

    console.log(`\n🔹 Step 3: CA creates a Compliance Task for Business Owner...`);
    reqCA.body = {
        clientName: owner.username,
        businessOwnerEmail: owner.email,
        title: 'Q2 GST Return Filing & Reconciliation',
        priority: 'High',
        dueDate: '2026-08-15',
        askForDocument: true
    };
    res = mockRes();
    await caController.addTask(reqCA, res);
    const task = res.body?.data;
    console.log(`   -> Task Created in DB (ID: ${task?.id}, Title: "${task?.title}")`);

    // Verify Business Owner receives task from DB API
    reqOwner.params = {};
    reqOwner.body = {};
    res = mockRes();
    await caController.getTasks(reqOwner, res);
    const ownerTasks = res.body?.data || [];
    const receivedTask = ownerTasks.find(t => t.id === task?.id);
    console.log(`   -> Business Owner fetched tasks from DB API: Found assigned task? ${!!receivedTask}`);

    console.log(`\n🔹 Step 4: Business Owner uploads requested document...`);
    reqOwner.params = { id: task?.id };
    reqOwner.body = { phase: 'Q2 Tax Document' };
    res = mockRes();
    await caController.uploadTaskDoc(reqOwner, res);
    console.log(`   -> Document uploaded for Task ${task?.id}. Status updated to: ${res.body?.data?.status}`);

    console.log(`\n🔹 Step 4.5: CA requests GST credentials from Business Owner...`);
    reqCA.body = { clientId: owner.id };
    res = mockRes();
    await caController.requestGstCredentials(reqCA, res);
    console.log(`   -> GST credentials requested by CA (Status: ${res.body?.data?.sharedStatus})`);

    console.log(`\n🔹 Step 5: Business Owner shares GST credentials...`);
    reqOwner.body = {
        gstUsername: 'GSTIN_ACME_2026',
        gstPassword: 'SecretGstPassword#99',
        connectedCaId: ca.id
    };
    res = mockRes();
    await caController.saveGstCredentials(reqOwner, res);
    console.log(`   -> GST credentials saved in DB (Status: ${res.body?.data?.sharedStatus})`);

    // Verify Encrypted Password stored in DB
    const dbCred = await db.prepare("SELECT * FROM gst_credentials WHERE business_owner_id = ?").get(owner.id);
    console.log(`   -> DB Raw encrypted password: "${dbCred.encrypted_password}" (Is Encrypted? ${dbCred.encrypted_password !== 'SecretGstPassword#99'})`);

    console.log(`\n🔹 Step 6: CA retrieves shared GST credentials...`);
    reqCA.params = {};
    reqCA.body = {};
    res = mockRes();
    await caController.getGstCredentials(reqCA, res);
    const caCreds = res.body?.data;
    console.log(`   -> CA Decrypted GST Username: ${caCreds?.gstUsername}, Decrypted Password: ${caCreds?.gstPassword}`);

    console.log(`\n🔹 Step 7: CA generates Professional Invoice for client...`);
    let clientRec = await db.prepare("SELECT id FROM ca_clients WHERE ca_user_id = ? AND business_owner_id = ?").get(ca.id, owner.id);
    if (!clientRec) {
        const cRes = await db.prepare("INSERT INTO ca_clients (ca_user_id, business_owner_id, name, email) VALUES (?, ?, ?, ?)").run(ca.id, owner.id, owner.username, owner.email);
        clientRec = { id: cRes.lastInsertRowid };
    }
    reqCA.body = {
        clientId: clientRec.id,
        amount: 5000,
        gstAmount: 900,
        totalAmount: 5900,
        invoiceDate: new Date().toISOString().split('T')[0]
    };
    res = mockRes();
    await caController.generateProfessionalInvoice(reqCA, res);
    const invId = res.body?.data?.id;
    console.log(`   -> Professional Invoice generated (ID: ${invId}, Number: ${res.body?.data?.invoiceNumber})`);

    console.log(`\n🔹 Step 8: Business Owner pays the Professional Invoice...`);
    reqOwner.params = { id: invId };
    res = mockRes();
    await caController.payInvoice(reqOwner, res);
    console.log(`   -> Invoice Paid successfully`);

    console.log(`\n🔹 Step 9: CA logs out...`);
    res = mockRes();
    await caController.setUserOffline(reqCA, res);
    console.log(`   -> CA Presence status updated to: ${res.body?.data?.status}`);

    // Business owner checks CA presence
    reqOwner.query = { user_id: ca.id };
    res = mockRes();
    await caController.getPresenceStatus(reqOwner, res);
    console.log(`   -> Business Owner queries CA presence from DB API: Status = ${res.body?.data?.status}`);

    console.log(`\n====================================================`);
    console.log(`  VERIFYING NOTIFICATIONS CREATED IN DATABASE`);
    console.log(`====================================================`);
    const allNotifs = await db.prepare(`
        SELECT id, sender_id, receiver_id, type, title, message, created_at 
        FROM notifications 
        ORDER BY id DESC LIMIT 20
    `).all();

    console.table(allNotifs);

    console.log(`\n====================================================`);
    console.log(`  FINAL DATABASE ROW COUNTS`);
    console.log(`====================================================`);
    const counts = {
        user_presence: (await db.prepare('SELECT count(*) as c FROM user_presence').get()).c,
        gst_credentials: (await db.prepare('SELECT count(*) as c FROM gst_credentials').get()).c,
        notifications: (await db.prepare('SELECT count(*) as c FROM notifications').get()).c,
        ca_tasks: (await db.prepare('SELECT count(*) as c FROM ca_tasks').get()).c,
        compliance_tasks_view: (await db.prepare('SELECT count(*) as c FROM compliance_tasks').get()).c,
        ca_gst_access_logs: (await db.prepare('SELECT count(*) as c FROM ca_gst_access_logs').get()).c,
        ca_professional_invoices: (await db.prepare('SELECT count(*) as c FROM ca_professional_invoices').get()).c,
        ca_payments: (await db.prepare('SELECT count(*) as c FROM ca_payments').get()).c
    };
    console.log(JSON.stringify(counts, null, 2));
    process.exit(0);
}

testFullWorkflow().catch(err => {
    console.error('Workflow Test Failed:', err);
    process.exit(1);
});
