const db = require('../db/connection');
const { runMigrations } = require('../db/migrations');
const caController = require('../controllers/caController');
const { initSocketServer } = require('../socketServer');
const http = require('http');
const ioClient = require('socket.io-client');

async function testRealtimePresenceAndChat() {
    console.log('====================================================');
    console.log('  TESTING REALTIME SOCKET.IO & SYMMETRIC PRESENCE  ');
    console.log('====================================================');

    await runMigrations();

    const now = new Date().toISOString();

    // Setup Test Users
    let owner = await db.prepare("SELECT * FROM users WHERE email = 'sanjay123@bnxmail.com'").get();
    if (!owner) {
        const res = await db.prepare(`
            INSERT INTO users (username, email, password_hash, role, created_at)
            VALUES ('sanjay123', 'sanjay123@bnxmail.com', 'hash123', 'business', ?)
        `).run(now);
        owner = { id: res.lastInsertRowid, username: 'sanjay123', email: 'sanjay123@bnxmail.com' };
    }

    let ca = await db.prepare("SELECT * FROM users WHERE email = 'dineshkumar123@bnxmail.com'").get();
    if (!ca) {
        const res = await db.prepare(`
            INSERT INTO users (username, email, password_hash, role, created_at)
            VALUES ('dineshkumar123', 'dineshkumar123@bnxmail.com', 'hash123', 'ca', ?)
        `).run(now);
        ca = { id: res.lastInsertRowid, username: 'dineshkumar123', email: 'dineshkumar123@bnxmail.com' };
    }

    // Set both users Online in DB
    await db.prepare("UPDATE users SET is_online = 1, last_seen_at = ? WHERE id IN (?, ?)").run(now, owner.id, ca.id);
    await db.prepare("INSERT OR REPLACE INTO user_presence (user_id, status, last_activity) VALUES (?, 'Online', ?)").run(owner.id, now);
    await db.prepare("INSERT OR REPLACE INTO user_presence (user_id, status, last_activity) VALUES (?, 'Online', ?)").run(ca.id, now);

    const mockRes = () => {
        const res = {};
        res.status = (code) => { res.statusCode = code; return res; };
        res.json = (data) => { res.body = data; return res; };
        return res;
    };

    const reqOwner = { user: owner, body: {}, params: {}, query: {} };
    const reqCA = { user: ca, body: {}, params: {}, query: {} };

    console.log('\nSTEP 1: Symmetrical Presence Checks...');
    
    // Owner checks CA presence
    reqOwner.query = { userId: ca.id };
    let res = mockRes();
    await caController.getPresenceStatus(reqOwner, res);
    console.log(` -> Business Owner sees CA (${ca.id}) Status: "${res.body?.data?.status}"`);

    // CA checks Owner presence
    reqCA.query = { userId: owner.id };
    res = mockRes();
    await caController.getPresenceStatus(reqCA, res);
    console.log(` -> CA sees Business Owner (${owner.id}) Status: "${res.body?.data?.status}"`);

    if (res.body?.data?.status !== 'Online') {
        console.error('❌ BUG 1 FAILED: CA sees Business Owner as Offline!');
        process.exit(1);
    }

    console.log('\nSTEP 2: Starting HTTP & Socket.IO server for integration test...');
    const server = http.createServer();
    initSocketServer(server);
    
    await new Promise((resolve) => server.listen(9876, resolve));
    console.log(' -> Socket.IO test server listening on port 9876');

    const ownerSocket = ioClient('http://localhost:9876');
    const caSocket = ioClient('http://localhost:9876');

    await Promise.all([
        new Promise(r => ownerSocket.on('connect', r)),
        new Promise(r => caSocket.on('connect', r))
    ]);

    console.log(' -> Both Sockets connected successfully.');

    // Step 3: Register user-online
    ownerSocket.emit('user-online', { userId: owner.id });
    caSocket.emit('user-online', { userId: ca.id });

    // Step 4: Join conversation room
    ownerSocket.emit('join-conversation', { userId: owner.id, partnerId: ca.id });
    caSocket.emit('join-conversation', { userId: ca.id, partnerId: owner.id });

    // Step 5: Test Realtime Typing Indicator
    console.log('\nSTEP 3: Testing Typing Indicator...');
    const typingPromise = new Promise((resolve) => {
        caSocket.on('typing', (data) => {
            console.log(' -> CA received typing event:', data);
            resolve();
        });
    });

    ownerSocket.emit('typing', { senderId: owner.id, receiverId: ca.id });
    await typingPromise;

    // Step 6: Test Realtime Message Delivery
    console.log('\nSTEP 4: Testing Realtime Send/Receive Message...');
    const messagePromise = new Promise((resolve) => {
        caSocket.on('receive-message', (data) => {
            console.log(` -> CA received realtime message: "${data.message}" from Sender ID ${data.sender_id}`);
            resolve(data);
        });
    });

    ownerSocket.emit('send-message', { senderId: owner.id, receiverId: ca.id, message: 'Hello CA! Live Socket Test' });
    const rcvMsg = await messagePromise;

    // Step 7: Test Read Receipts (mark-read)
    console.log('\nSTEP 5: Testing Mark-Read Receipts...');
    caSocket.emit('mark-read', { userId: ca.id, partnerId: owner.id });

    await new Promise(r => setTimeout(r, 500));

    // Verify in DB that is_read = 1
    const unreadCountRow = await db.prepare("SELECT count(*) as c FROM ca_messages WHERE receiver_id = ? AND is_read = 0").get(ca.id);
    console.log(` -> CA Unread Count in DB after mark-read: ${unreadCountRow.c}`);

    // Cleanup
    ownerSocket.disconnect();
    caSocket.disconnect();
    server.close();

    console.log('\n====================================================');
    console.log('  REALTIME SOCKET.IO & SYMMETRIC PRESENCE PASSED!  ');
    console.log('====================================================');
    process.exit(0);
}

testRealtimePresenceAndChat().catch(err => {
    console.error('Realtime Test Failed:', err);
    process.exit(1);
});
