const request = require('supertest');
const app = require('../app');
const db = require('../db/connection');

async function testBackendEndpoints() {
    console.log('====================================================');
    console.log('   VERIFYING BACKEND SSO & PRESENCE ROUTE HANDLERS  ');
    console.log('====================================================\n');

    // 1. Test POST /api/v1/auth/sso
    console.log('--- 1. Testing POST /api/v1/auth/sso ---');
    const ssoRes = await request(app)
        .post('/api/v1/auth/sso')
        .send({ bnxToken: 'test-bnx-token', appType: 'BUSINESS' });
    
    console.log('POST /api/v1/auth/sso Status:', ssoRes.status);
    console.log('POST /api/v1/auth/sso Body:', ssoRes.body);

    // 2. Test GET /api/v1/auth/sso fallback
    console.log('\n--- 2. Testing GET /api/v1/auth/sso ---');
    const getSsoRes = await request(app)
        .get('/api/v1/auth/sso?bnxToken=test-bnx-token&appType=BUSINESS');
    console.log('GET /api/v1/auth/sso Status:', getSsoRes.status);
    console.log('GET /api/v1/auth/sso Body:', getSsoRes.body);

    // 3. Obtain auth token for presence tests
    const user = await db.prepare("SELECT * FROM users LIMIT 1").get();
    const tokenService = require('../utils/tokenService');
    const token = tokenService.generateToken(user);

    // 4. Test POST /api/v1/presence/login
    console.log('\n--- 4. Testing POST /api/v1/presence/login ---');
    const presLoginRes = await request(app)
        .post('/api/v1/presence/login')
        .set('Authorization', `Bearer ${token}`)
        .send({});
    console.log('POST /api/v1/presence/login Status:', presLoginRes.status);
    console.log('POST /api/v1/presence/login Body:', presLoginRes.body);

    // 5. Test GET /api/v1/presence/login fallback
    console.log('\n--- 5. Testing GET /api/v1/presence/login ---');
    const getPresLoginRes = await request(app)
        .get('/api/v1/presence/login')
        .set('Authorization', `Bearer ${token}`);
    console.log('GET /api/v1/presence/login Status:', getPresLoginRes.status);
    console.log('GET /api/v1/presence/login Body:', getPresLoginRes.body);

    // 6. Test POST /api/v1/presence/heartbeat
    console.log('\n--- 6. Testing POST /api/v1/presence/heartbeat ---');
    const hbRes = await request(app)
        .post('/api/v1/presence/heartbeat')
        .set('Authorization', `Bearer ${token}`)
        .send({});
    console.log('POST /api/v1/presence/heartbeat Status:', hbRes.status);
    console.log('POST /api/v1/presence/heartbeat Body:', hbRes.body);

    console.log('\nBackend Route Tests Complete.');
}

testBackendEndpoints().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
