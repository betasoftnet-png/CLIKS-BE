const request = require('supertest');
const app = require('../app');
const db = require('../db/connection');
const tokenService = require('../utils/tokenService');

async function testBackendEndpoints() {
    console.log('====================================================');
    console.log('   VERIFYING ALL 3 POST ENDPOINTS ON LOCAL BACKEND  ');
    console.log('====================================================\n');

    // 1. Test POST /api/v1/auth/sso
    console.log('--- 1. Testing POST /api/v1/auth/sso ---');
    const ssoRes = await request(app)
        .post('/api/v1/auth/sso')
        .send({ bnxToken: 'test-bnx-token', appType: 'BUSINESS' });
    
    console.log('POST /api/v1/auth/sso Status:', ssoRes.status);
    console.log('POST /api/v1/auth/sso Body:', ssoRes.body);

    // Obtain user & generate valid auth token
    const user = await db.prepare("SELECT * FROM users LIMIT 1").get();
    const { accessToken: token } = await tokenService.issueTokens(user);

    // 2. Test POST /api/v1/presence/login
    console.log('\n--- 2. Testing POST /api/v1/presence/login ---');
    const presLoginRes = await request(app)
        .post('/api/v1/presence/login')
        .set('Authorization', `Bearer ${token}`)
        .send({});
    console.log('POST /api/v1/presence/login Status:', presLoginRes.status);
    console.log('POST /api/v1/presence/login Body:', presLoginRes.body);

    // 3. Test POST /api/v1/presence/heartbeat
    console.log('\n--- 3. Testing POST /api/v1/presence/heartbeat ---');
    const hbRes = await request(app)
        .post('/api/v1/presence/heartbeat')
        .set('Authorization', `Bearer ${token}`)
        .send({});
    console.log('POST /api/v1/presence/heartbeat Status:', hbRes.status);
    console.log('POST /api/v1/presence/heartbeat Body:', hbRes.body);

    console.log('\n====================================================');
    console.log('ALL 3 ENDPOINTS TESTED ON LOCAL BACKEND.');
    console.log('====================================================');
}

testBackendEndpoints().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
