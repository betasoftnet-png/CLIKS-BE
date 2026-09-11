const request = require('supertest');
const app = require('../app');

async function runTests() {
    console.log('Testing FIN-PRO endpoints...');

    // 1. Overview
    const resOverview = await request(app)
        .get('/api/v1/finpro/analytics/overview')
        .set('Authorization', 'Bearer developer-token');
    console.log('GET /analytics/overview status:', resOverview.status, 'success:', resOverview.body.success, 'kpis:', resOverview.body.data?.kpis);

    // 2. Engagements
    const resEngagements = await request(app)
        .get('/api/v1/finpro/engagements')
        .set('Authorization', 'Bearer developer-token');
    console.log('GET /engagements status:', resEngagements.status, 'count:', resEngagements.body.data?.length);

    // 3. Create Engagement
    const resCreate = await request(app)
        .post('/api/v1/finpro/engagements')
        .set('Authorization', 'Bearer developer-token')
        .send({
            clientName: 'Test Automation Co Ltd',
            trade: 'Software Solutions',
            entityType: 'Private Limited',
            financialYear: '2025-2026',
            agreedFee: 180000,
            scopeOfWork: ['Statutory Audit Sec 139']
        });
    console.log('POST /engagements status:', resCreate.status, 'created:', resCreate.body.data?.clientName);

    // 4. Checklists
    const resChecklists = await request(app)
        .get('/api/v1/finpro/checklists')
        .set('Authorization', 'Bearer developer-token');
    console.log('GET /checklists status:', resChecklists.status, 'count:', resChecklists.body.data?.length);

    // 5. Tasks
    const resTasks = await request(app)
        .get('/api/v1/finpro/tasks')
        .set('Authorization', 'Bearer developer-token');
    console.log('GET /tasks status:', resTasks.status, 'count:', resTasks.body.data?.length);

    // 6. Update Task Stage
    const resStage = await request(app)
        .patch('/api/v1/finpro/tasks/1/stage')
        .set('Authorization', 'Bearer developer-token')
        .send({ stage: 'Under Review' });
    console.log('PATCH /tasks/1/stage status:', resStage.status, 'new stage:', resStage.body.data?.stage);

    console.log('All FIN-PRO endpoints tested successfully!');
    process.exit(0);
}

runTests().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
});
