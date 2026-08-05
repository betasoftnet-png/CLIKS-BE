const db = require('../db/connection');
const { runMigrations } = require('../db/migrations');
const caController = require('../controllers/caController');

async function testMessengerBugfix() {
    console.log('====================================================');
    console.log('  TESTING FIN-PRO MESSENGER USER & CLIENT ID SYNC');
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

    // 3. Setup ca_clients record with row ID e.g. 99
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

    const reqOwner = { user: owner, body: {}, params: {}, query: {} };
    const reqCA = { user: ca, body: {}, params: {}, query: {} };

    console.log(`\nUser Setup:\n - Business Owner ID: ${owner.id} (${owner.username})\n - CA User ID: ${ca.id} (${ca.username})\n - Practice Client Table Row ID: ${client.id}`);

    console.log('\nSTEP 1: Business Owner sends "Hi" to CA User ID...');
    reqOwner.body = { receiverId: ca.id, message: 'Hi' };
    let res = mockRes();
    await caController.sendChatMessage(reqOwner, res);
    console.log(' -> Business Owner Message Sent ID:', res.body?.data?.id, 'Message:', res.body?.data?.message);

    console.log('\nSTEP 2: CA opens chat using Practice Client Row ID (client.id)...');
    reqCA.params = { partnerId: client.id }; // CA passes client.id (e.g. 99)
    res = mockRes();
    await caController.getChatMessages(reqCA, res);
    const caMsgs = res.body?.data || [];
    console.log(` -> CA fetched ${caMsgs.length} message(s) passing client.id = ${client.id}`);
    console.log(` -> Message received by CA: "${caMsgs[caMsgs.length - 1]?.message}" from ${caMsgs[caMsgs.length - 1]?.sender_name}`);

    console.log('\nSTEP 3: CA replies "Hello" using Practice Client Row ID (client.id)...');
    reqCA.body = { receiverId: client.id, message: 'Hello' };
    res = mockRes();
    await caController.sendChatMessage(reqCA, res);
    console.log(' -> CA Reply Sent ID:', res.body?.data?.id, 'Receiver ID in DB:', res.body?.data?.receiver_id, 'Message:', res.body?.data?.message);

    console.log('\nSTEP 4: Business Owner opens chat and fetches conversation...');
    reqOwner.params = { partnerId: ca.id };
    res = mockRes();
    await caController.getChatMessages(reqOwner, res);
    const ownerMsgs = res.body?.data || [];
    console.log(` -> Business Owner fetched ${ownerMsgs.length} message(s) in thread:`);
    ownerMsgs.forEach((m, idx) => {
        console.log(`     [${idx + 1}] ${m.sender_name || (m.sender_id === ca.id ? 'CA' : 'Owner')}: "${m.message}"`);
    });

    if (ownerMsgs.length === 2 && ownerMsgs[0].message === 'Hi' && ownerMsgs[1].message === 'Hello') {
        console.log('\n====================================================');
        console.log('  FIN-PRO MESSENGER USER & CLIENT ID SYNC PASSED!  ');
        console.log('====================================================');
        process.exit(0);
    } else {
        console.error('FAILED: Message count or content mismatch', ownerMsgs);
        process.exit(1);
    }
}

testMessengerBugfix().catch(err => {
    console.error('Messenger Bugfix Test Failed:', err);
    process.exit(1);
});
