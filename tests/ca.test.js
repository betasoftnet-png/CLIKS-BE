const request = require('supertest');
const app = require('../app');
const { runMigrations } = require('../db/migrations');
const db = require('../db/connection');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-jwt-secret';

describe('Chartered Accountant CA Command Centre Tests', () => {
    let tokenUser1 = '';
    let tokenUser2 = '';

    beforeAll(async () => {
        await runMigrations();

        // Seed two test users in the database
        // Delete existing records to ensure starting from clean state
        await db.prepare("DELETE FROM users").run();
        await db.prepare("DELETE FROM ca_invitations").run();

        await db.prepare(`
            INSERT INTO users (id, username, email, password_hash, role, business_name)
            VALUES (1, 'business', 'business@cliks.com', 'hashedpassword', 'business', 'Acme Corp')
        `).run();

        await db.prepare(`
            INSERT INTO users (id, username, email, password_hash, role, business_name)
            VALUES (2, 'ca_user', 'ca@cliks.com', 'hashedpassword', 'ca', 'Cliks Advisory')
        `).run();

        // Sign tokens for these test users
        tokenUser1 = jwt.sign({ id: 1, email: 'business@cliks.com', username: 'business', role: 'business' }, 'test-jwt-secret');
        tokenUser2 = jwt.sign({ id: 2, email: 'ca@cliks.com', username: 'ca_user', role: 'ca' }, 'test-jwt-secret');
    });

    it('should initialize compliance scan successfully', async () => {
        const caController = require('../controllers/caController');
        expect(caController.runComplianceScan).toBeDefined();
        expect(caController.getScanHistory).toBeDefined();
        expect(caController.applyCrossBorderAudit).toBeDefined();
    });

    it('should apply cross-border accounting rules correctly', async () => {
        const caController = require('../controllers/caController');
        
        // Mock express req/res
        const req = { body: { standard: 'US_GAAP' } };
        const res = {
            status: function(code) {
                this.statusCode = code;
                return this;
            },
            json: function(data) {
                this.body = data;
                return this;
            }
        };

        await caController.applyCrossBorderAudit(req, res);
        expect(res.body.success).toBe(true);
        expect(res.body.data.standard).toBe('US_GAAP');
        expect(res.body.data.rulesApplied).toContain('LIFO');
    });

    // CA Invitations Integration Tests
    describe('CA Invitation Flow', () => {
        let invitationId;

        it('should fail to invite oneself', async () => {
            const res = await request(app)
                .post('/api/v1/ca/invitations')
                .set('Authorization', `Bearer ${tokenUser1}`)
                .send({ email: 'business@cliks.com' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.message).toContain('invite yourself');
        });

        it('should send an invitation successfully', async () => {
            const res = await request(app)
                .post('/api/v1/ca/invitations')
                .set('Authorization', `Bearer ${tokenUser1}`)
                .send({ email: 'ca@cliks.com' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toHaveProperty('id');
            expect(res.body.data.receiver_email).toBe('ca@cliks.com');
            expect(res.body.data.status).toBe('Pending');
            expect(res.body.data.sender_name).toBe('Acme Corp');

            invitationId = res.body.data.id;
        });

        it('should fail to send a duplicate invitation', async () => {
            const res = await request(app)
                .post('/api/v1/ca/invitations')
                .set('Authorization', `Bearer ${tokenUser1}`)
                .send({ email: 'ca@cliks.com' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.message).toContain('already pending');
        });

        it('should fetch outgoing invitations for the sender', async () => {
            const res = await request(app)
                .get('/api/v1/ca/invitations/outgoing')
                .set('Authorization', `Bearer ${tokenUser1}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data)).toBe(true);
            expect(res.body.data.length).toBe(1);
            expect(res.body.data[0].id).toBe(invitationId);
        });

        it('should fetch incoming invitations for the receiver', async () => {
            const res = await request(app)
                .get('/api/v1/ca/invitations/incoming')
                .set('Authorization', `Bearer ${tokenUser2}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data)).toBe(true);
            expect(res.body.data.length).toBe(1);
            expect(res.body.data[0].id).toBe(invitationId);
        });

        it('should accept the invitation successfully', async () => {
            const res = await request(app)
                .post(`/api/v1/ca/invitations/${invitationId}/accept`)
                .set('Authorization', `Bearer ${tokenUser2}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe('Accepted');
        });

        it('should delete/revoke the invitation successfully', async () => {
            const res = await request(app)
                .delete(`/api/v1/ca/invitations/${invitationId}`)
                .set('Authorization', `Bearer ${tokenUser1}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            // Double check that the database invitation list is now empty
            const checkRes = await request(app)
                .get('/api/v1/ca/invitations/outgoing')
                .set('Authorization', `Bearer ${tokenUser1}`);
            expect(checkRes.body.data.length).toBe(0);
        });
    });

    describe('Practice Workspace Management Endpoints', () => {
        beforeAll(async () => {
            // Clear practice tables
            await db.prepare("DELETE FROM ca_clients").run();
            await db.prepare("DELETE FROM ca_client_requests").run();
            await db.prepare("DELETE FROM ca_tasks").run();
            await db.prepare("DELETE FROM ca_timesheets").run();
            await db.prepare("DELETE FROM ca_folders").run();
            await db.prepare("DELETE FROM ca_files").run();
        });

        it('should lazy-seed and fetch clients successfully', async () => {
            const res = await request(app)
                .get('/api/v1/ca/clients')
                .set('Authorization', `Bearer ${tokenUser1}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.length).toBe(5); // Default seeded count is 5
            expect(res.body.data[0]).toHaveProperty('pendingFilings');
            expect(res.body.data[0]).toHaveProperty('regime');
        });

        it('should register a new client successfully', async () => {
            const res = await request(app)
                .post('/api/v1/ca/clients')
                .set('Authorization', `Bearer ${tokenUser1}`)
                .send({
                    name: 'Test Business Inc',
                    email: 'testinc@test.com',
                    status: 'Active',
                    regime: 'New',
                    income: 5000000
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.name).toBe('Test Business Inc');
            expect(res.body.data.pendingFilings).toBe(0);
        });

        it('should lazy-seed and fetch client requests successfully', async () => {
            const res = await request(app)
                .get('/api/v1/ca/requests')
                .set('Authorization', `Bearer ${tokenUser1}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.length).toBe(4); // Default seeded requests
            expect(res.body.data[0]).toHaveProperty('attachedFile');
        });

        it('should issue a new client request successfully', async () => {
            const res = await request(app)
                .post('/api/v1/ca/requests')
                .set('Authorization', `Bearer ${tokenUser1}`)
                .send({
                    clientName: 'Test Business Inc',
                    title: 'Form 26AS Verification',
                    description: 'Check tax credits.',
                    priority: 'Medium',
                    docType: 'Form 26AS'
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.title).toBe('Form 26AS Verification');
            expect(res.body.data.status).toBe('Awaiting Client');
        });

        it('should simulate client upload and approve documents successfully', async () => {
            // First fetch requests to get an ID
            const getRes = await request(app)
                .get('/api/v1/ca/requests')
                .set('Authorization', `Bearer ${tokenUser1}`);

            const targetId = getRes.body.data[0].id;

            // Upload
            const uploadRes = await request(app)
                .post(`/api/v1/ca/requests/${targetId}/upload`)
                .set('Authorization', `Bearer ${tokenUser1}`);

            expect(uploadRes.status).toBe(200);
            expect(uploadRes.body.success).toBe(true);
            expect(uploadRes.body.data.status).toBe('Under Review');
            expect(uploadRes.body.data.attachedFile).toContain('simulated_upload');

            // Approve
            const approveRes = await request(app)
                .post(`/api/v1/ca/requests/${targetId}/approve`)
                .set('Authorization', `Bearer ${tokenUser1}`);

            expect(approveRes.status).toBe(200);
            expect(approveRes.body.success).toBe(true);
            expect(approveRes.body.data.status).toBe('Approved');
        });

        it('should lazy-seed and fetch operations tasks', async () => {
            const res = await request(app)
                .get('/api/v1/ca/tasks')
                .set('Authorization', `Bearer ${tokenUser1}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.length).toBe(5); // Default seeded tasks
        });

        it('should create a task and cycle its status successfully', async () => {
            // Create
            const res = await request(app)
                .post('/api/v1/ca/tasks')
                .set('Authorization', `Bearer ${tokenUser1}`)
                .send({
                    clientName: 'Test Business Inc',
                    title: 'Upload TDS Return',
                    priority: 'High'
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe('Pending');

            const taskId = res.body.data.id;

            // Toggle once (Pending -> In Progress)
            const toggle1 = await request(app)
                .post(`/api/v1/ca/tasks/${taskId}/toggle`)
                .set('Authorization', `Bearer ${tokenUser1}`);

            expect(toggle1.status).toBe(200);
            expect(toggle1.body.data.status).toBe('In Progress');

            // Toggle twice (In Progress -> Completed)
            const toggle2 = await request(app)
                .post(`/api/v1/ca/tasks/${taskId}/toggle`)
                .set('Authorization', `Bearer ${tokenUser1}`);

            expect(toggle2.body.data.status).toBe('Completed');
        });

        it('should lazy-seed and fetch timesheets & create a new entry', async () => {
            const res = await request(app)
                .get('/api/v1/ca/timesheets')
                .set('Authorization', `Bearer ${tokenUser1}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.length).toBe(4);

            const addRes = await request(app)
                .post('/api/v1/ca/timesheets')
                .set('Authorization', `Bearer ${tokenUser1}`)
                .send({
                    clientName: 'Test Business Inc',
                    taskName: 'Financial Statement Audit',
                    duration: '03:15:00',
                    billable: true
                });

            expect(addRes.status).toBe(200);
            expect(addRes.body.success).toBe(true);
            expect(addRes.body.data.duration).toBe('03:15:00');
            expect(addRes.body.data.billable).toBe(true);
        });

        it('should lazy-seed documents and upload files successfully', async () => {
            // Folders
            const folderRes = await request(app)
                .get('/api/v1/ca/documents/folders')
                .set('Authorization', `Bearer ${tokenUser1}`);

            expect(folderRes.status).toBe(200);
            expect(folderRes.body.data.length).toBe(4);

            // Files
            const fileRes = await request(app)
                .get('/api/v1/ca/documents/files')
                .set('Authorization', `Bearer ${tokenUser1}`);

            expect(fileRes.status).toBe(200);
            expect(fileRes.body.data.length).toBe(4);

            const initialFolderCount = folderRes.body.data[0].count; // ITR Filings folder is first

            // Add File
            const addFileRes = await request(app)
                .post('/api/v1/ca/documents/files')
                .set('Authorization', `Bearer ${tokenUser1}`)
                .send({
                    name: 'test_report_final.pdf',
                    size: '1.5 MB',
                    folderName: 'ITR Filings FY2025-26'
                });

            expect(addFileRes.status).toBe(200);
            expect(addFileRes.body.success).toBe(true);
            expect(addFileRes.body.data.name).toBe('test_report_final.pdf');

            // Verify count incremented
            const refetchedFolders = await request(app)
                .get('/api/v1/ca/documents/folders')
                .set('Authorization', `Bearer ${tokenUser1}`);

            expect(refetchedFolders.body.data[0].count).toBe(initialFolderCount + 1);

            const newFileId = addFileRes.body.data.id;

            // Delete File
            const delRes = await request(app)
                .delete(`/api/v1/ca/documents/files/${newFileId}`)
                .set('Authorization', `Bearer ${tokenUser1}`);

            expect(delRes.status).toBe(200);
            expect(delRes.body.success).toBe(true);

            // Verify count decremented
            const finalFolders = await request(app)
                .get('/api/v1/ca/documents/folders')
                .set('Authorization', `Bearer ${tokenUser1}`);

            expect(finalFolders.body.data[0].count).toBe(initialFolderCount);
        });

        it('should execute complete private GST sharing flow, encrypt password, audit access, and support revoking', async () => {
            // 1. Save GST credentials as the Business Owner (tokenUser1)
            const saveRes = await request(app)
                .post('/api/v1/ca/owner/gst-credentials')
                .set('Authorization', `Bearer ${tokenUser1}`)
                .send({
                    gstUsername: 'sanjay_gst_login@bnxmail.com',
                    gstPassword: 'SanjayGSTPass123!'
                });

            expect(saveRes.status).toBe(200);
            expect(saveRes.body.success).toBe(true);

            // Verify password is encrypted in the database (i.e., not stored in plaintext)
            const dbUser = await db.prepare("SELECT gst_password FROM users WHERE email = 'business@cliks.com'").get();
            expect(dbUser.gst_password).not.toBe('SanjayGSTPass123!');
            expect(dbUser.gst_password).toContain(':'); // Cipher contains IV separator

            // 2. Fetch GST credentials as the Business Owner (tokenUser1)
            const getOwnerRes = await request(app)
                .get('/api/v1/ca/owner/gst-credentials')
                .set('Authorization', `Bearer ${tokenUser1}`);

            expect(getOwnerRes.status).toBe(200);
            expect(getOwnerRes.body.success).toBe(true);
            expect(getOwnerRes.body.data.gstUsername).toBe('sanjay_gst_login@bnxmail.com');
            expect(getOwnerRes.body.data.gstPassword).toBe('SanjayGSTPass123!');

            // 3. Register client Acme Corp mapping User 1 (business owner) to User 2 (CA)
            const registerRes = await request(app)
                .post('/api/v1/ca/clients')
                .set('Authorization', `Bearer ${tokenUser2}`)
                .send({
                    name: 'Acme Corp',
                    email: 'business@cliks.com',
                    status: 'Active',
                    regime: 'New',
                    income: 5000000
                });

            expect(registerRes.status).toBe(200);
            const clientId = registerRes.body.data.id;

            // Clear previous access logs
            await db.prepare("DELETE FROM ca_gst_access_logs").run();

            // 4. Fetch credentials as the authorized CA (tokenUser2) and confirm log is created
            const getCaRes = await request(app)
                .get(`/api/v1/ca/clients/${clientId}/gst-credentials`)
                .set('Authorization', `Bearer ${tokenUser2}`);

            expect(getCaRes.status).toBe(200);
            expect(getCaRes.body.success).toBe(true);
            expect(getCaRes.body.data.gstUsername).toBe('sanjay_gst_login@bnxmail.com');
            expect(getCaRes.body.data.gstPassword).toBe('SanjayGSTPass123!');

            // Assert access log entry exists
            const logs = await db.prepare("SELECT * FROM ca_gst_access_logs WHERE client_id = ?").all(clientId);
            expect(logs.length).toBe(1);
            expect(logs[0].ca_user_id).toBe(2);
            expect(logs[0].ca_name).toBe('ca_user');
            expect(logs[0].client_name).toBe('Acme Corp');
            expect(logs[0].accessed_at).toBeTruthy();
            expect(logs[0].ip_address).toBeTruthy();

            // 5. Try to fetch as unauthorized user/role (tokenUser1) -> should fail (403)
            const unauthRes = await request(app)
                .get(`/api/v1/ca/clients/${clientId}/gst-credentials`)
                .set('Authorization', `Bearer ${tokenUser1}`);

            expect(unauthRes.status).toBe(403);

            // 6. Try to fetch non-existent client -> should fail (404)
            const notFoundRes = await request(app)
                .get('/api/v1/ca/clients/99999/gst-credentials')
                .set('Authorization', `Bearer ${tokenUser2}`);

            expect(notFoundRes.status).toBe(404);

            // 7. Revoke credentials as Business Owner (tokenUser1)
            const revokeRes = await request(app)
                .delete('/api/v1/ca/owner/gst-credentials')
                .set('Authorization', `Bearer ${tokenUser1}`);

            expect(revokeRes.status).toBe(200);
            expect(revokeRes.body.success).toBe(true);

            // 8. Fetch again as CA -> should return null values
            const getCaRevokedRes = await request(app)
                .get(`/api/v1/ca/clients/${clientId}/gst-credentials`)
                .set('Authorization', `Bearer ${tokenUser2}`);

            expect(getCaRevokedRes.status).toBe(200);
            expect(getCaRevokedRes.body.data.gstUsername).toBeNull();
            expect(getCaRevokedRes.body.data.gstPassword).toBeNull();
        });
    });
});

