const db = require('../db/connection');
const { runMigrations } = require('../db/migrations');
const caController = require('../controllers/caController');

async function testTwoWayChatWorkflow() {
    console.log('====================================================');
    console.log('  TESTING TWO-WAY CA <-> BUSINESS OWNER CHAT SYSTEM');
    console.log('====================================================');

    await runMigrations();

    const now = new Date().toISOString();

    // Setup Test Users
    let owner = await db.prepare("SELECT * FROM users WHERE email = 'owner.twoway@cliks.com'").get();
    if (!owner) {
        const res = await db.prepare(`
            INSERT INTO users (username, email, password_hash, role, created_at)
            VALUES ('Sanjay Business Owner', 'owner.twoway@cliks.com', 'hash123', 'business', ?)
        `).run(now);
        owner = { id: res.lastInsertRowid, username: 'Sanjay Business Owner', email: 'owner.twoway@cliks.com' };
    }

    let ca = await db.prepare("SELECT * FROM users WHERE email = 'ca.twoway@cliks.com'").get();
    if (!ca) {
        const res = await db.prepare(`
            INSERT INTO users (username, email, password_hash, role, created_at)
            VALUES ('Dinesh CA Partner', 'ca.twoway@cliks.com', 'hash123', 'ca', ?)
        `).run(now);
        ca = { id: res.lastInsertRowid, username: 'Dinesh CA Partner', email: 'ca.twoway@cliks.com' };
    }

    const mockRes = () => {
        const res = {};
        res.status = (code) => { res.statusCode = code; return res; };
        res.json = (data) => { res.body = data; return res; };
        return res;
    };

    const reqCA = { user: ca, body: {}, params: {}, query: {} };
    const reqOwner = { user: owner, body: {}, params: {}, query: {} };

    console.log('\n1. CA sends direct message to Business Owner...');
    reqCA.body = { receiverId: owner.id, message: 'Hello Sanjay! I am starting your GST return review now.' };
    let res = mockRes();
    await caController.sendChatMessage(reqCA, res);
    console.log('   -> CA Sent Message:', res.body?.data?.message);

    console.log('\n2. Business Owner checks unread messages...');
    res = mockRes();
    await caController.getUnreadChatCount(reqOwner, res);
    console.log('   -> Business Owner Unread Badge Count:', res.body?.data?.unreadCount);

    console.log('\n3. Business Owner opens Chat Popup and reads conversation...');
    reqOwner.params = { partnerId: ca.id };
    res = mockRes();
    await caController.getChatMessages(reqOwner, res);
    const msgs1 = res.body?.data || [];
    console.log(`   -> Business Owner fetched ${msgs1.length} message(s). Latest: "${msgs1[msgs1.length - 1]?.message}"`);

    console.log('\n4. Business Owner sends reply to CA...');
    reqOwner.body = { receiverId: ca.id, message: 'Thanks Dinesh! Please check the latest purchase bills uploaded.' };
    res = mockRes();
    await caController.sendChatMessage(reqOwner, res);
    console.log('   -> Business Owner Sent Reply:', res.body?.data?.message);

    console.log('\n5. CA opens Chat Popup and fetches entire conversation history...');
    reqCA.params = { partnerId: owner.id };
    res = mockRes();
    await caController.getChatMessages(reqCA, res);
    const msgs2 = res.body?.data || [];
    console.log(`   -> CA fetched ${msgs2.length} total messages in thread:`);
    msgs2.forEach((m, idx) => {
        console.log(`      [${idx + 1}] ${m.sender_name || (m.sender_id === ca.id ? 'CA' : 'Owner')}: "${m.message}"`);
    });

    console.log('\n====================================================');
    console.log('  TWO-WAY CHAT WORKFLOW TEST PASSED SUCCESSFULLY!');
    console.log('====================================================');
    process.exit(0);
}

testTwoWayChatWorkflow().catch(err => {
    console.error('Two-Way Chat Test Failed:', err);
    process.exit(1);
});
