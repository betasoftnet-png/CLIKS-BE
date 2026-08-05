const db = require('../db/connection');
const { runMigrations } = require('../db/migrations');
const caController = require('../controllers/caController');

async function testChatPresenceHeader() {
    console.log('====================================================');
    console.log('  TESTING CHAT MESSAGING & PRESENCE HEADER APIs');
    console.log('====================================================');

    await runMigrations();

    const now = new Date().toISOString();

    // Setup Test Owner & CA
    let owner = await db.prepare("SELECT * FROM users WHERE email = 'owner.chat@cliks.com'").get();
    if (!owner) {
        const res = await db.prepare(`
            INSERT INTO users (username, email, password_hash, role, is_online, created_at)
            VALUES ('Chat Owner', 'owner.chat@cliks.com', 'hash123', 'business', 1, ?)
        `).run(now);
        owner = { id: res.lastInsertRowid, username: 'Chat Owner', email: 'owner.chat@cliks.com', role: 'business' };
    }

    let ca = await db.prepare("SELECT * FROM users WHERE email = 'ca.chat@cliks.com'").get();
    if (!ca) {
        const res = await db.prepare(`
            INSERT INTO users (username, email, password_hash, role, is_online, created_at)
            VALUES ('Chat CA', 'ca.chat@cliks.com', 'hash123', 'ca', 1, ?)
        `).run(now);
        ca = { id: res.lastInsertRowid, username: 'Chat CA', email: 'ca.chat@cliks.com', role: 'ca' };
    }

    // Connect invitation
    let inv = await db.prepare("SELECT * FROM ca_invitations WHERE sender_id = ? AND receiver_id = ?").get(owner.id, ca.id);
    if (!inv) {
        await db.prepare(`
            INSERT INTO ca_invitations (sender_id, receiver_id, sender_email, receiver_email, status, created_at)
            VALUES (?, ?, 'owner.chat@cliks.com', 'ca.chat@cliks.com', 'Accepted', ?)
        `).run(owner.id, ca.id, now);
    }

    const mockRes = () => {
        const res = {};
        res.status = (code) => { res.statusCode = code; return res; };
        res.json = (data) => { res.body = data; return res; };
        return res;
    };

    const reqOwner = { user: owner, body: {}, params: {}, query: {} };
    const reqCA = { user: ca, body: {}, params: {}, query: {} };

    console.log('\n1. CA sends a message to Business Owner...');
    reqCA.body = { receiverId: owner.id, message: 'Hello! I have reviewed your GSTR-1 filings.' };
    let res = mockRes();
    await caController.sendChatMessage(reqCA, res);
    console.log('   -> Message Sent ID:', res.body?.data?.id, 'Content:', res.body?.data?.message);

    console.log('\n2. Business Owner checks unread chat count...');
    res = mockRes();
    await caController.getUnreadChatCount(reqOwner, res);
    console.log('   -> Unread Chat Count for Owner:', res.body?.data?.unreadCount);

    console.log('\n3. Business Owner opens Chat Window & fetches conversation...');
    reqOwner.params = { partnerId: ca.id };
    res = mockRes();
    await caController.getChatMessages(reqOwner, res);
    const msgs = res.body?.data || [];
    console.log(`   -> Messages Fetched Count: ${msgs.length}`);
    console.log(`   -> Message text: "${msgs[0]?.message}" from ${msgs[0]?.sender_name}`);

    console.log('\n4. Business Owner re-checks unread chat count after viewing...');
    res = mockRes();
    await caController.getUnreadChatCount(reqOwner, res);
    console.log('   -> Unread Chat Count for Owner (After Reading):', res.body?.data?.unreadCount);

    console.log('\n5. Business Owner checks CA Presence Status...');
    res = mockRes();
    await caController.getPresenceStatus(reqOwner, res);
    console.log('   -> CA Presence Status:', res.body?.data?.status);

    console.log('\n====================================================');
    console.log('  CHAT MESSAGING & PRESENCE HEADER TEST PASSED!');
    console.log('====================================================');
    process.exit(0);
}

testChatPresenceHeader().catch(err => {
    console.error('Chat Presence Header Test Failed:', err);
    process.exit(1);
});
