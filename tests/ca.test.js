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

        // Ensure new GST credential columns exist (initTableAndColumns in caController is async fire-and-forget)
        try { await db.prepare("ALTER TABLE users ADD COLUMN gst_username TEXT").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE users ADD COLUMN gst_password TEXT").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE users ADD COLUMN gst_share_status TEXT DEFAULT 'Not Shared'").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE users ADD COLUMN gst_shared_at TEXT").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE users ADD COLUMN gst_connected_advisor_id INTEGER").run(); } catch(e) {}

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
            // Log columns of ca_clients
            try {
                const info = await db.prepare("PRAGMA table_info(ca_clients)").all();
                console.log('DEBUG: ca_clients schema columns:', info.map(c => c.name));
            } catch (e) {
                console.log('DEBUG: error fetching ca_clients info:', e.message);
            }
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
            
            // Assert all required properties exist
            expect(res.body.data).toHaveProperty('taskId');
            expect(res.body.data).toHaveProperty('advisorId');
            expect(res.body.data).toHaveProperty('advisorEmail');
            expect(res.body.data).toHaveProperty('clientId');
            expect(res.body.data).toHaveProperty('clientName');
            expect(res.body.data).toHaveProperty('taskDescription');
            expect(res.body.data).toHaveProperty('priority');
            expect(res.body.data).toHaveProperty('dueDate');
            expect(res.body.data).toHaveProperty('status');
            expect(res.body.data).toHaveProperty('createdAt');

            const taskId = res.body.data.id;

            // Attempt to create a duplicate task - should return the existing task (or indicate success/exists status)
            const dupRes = await request(app)
                .post('/api/v1/ca/tasks')
                .set('Authorization', `Bearer ${tokenUser1}`)
                .send({
                    clientName: 'Test Business Inc',
                    title: 'Upload TDS Return',
                    priority: 'High'
                });
            expect(dupRes.status).toBe(200);
            expect(dupRes.body.data.id).toBe(taskId); // should match original task ID

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
            // 0. Create an accepted invitation from User1 (business) to User2 (CA)
            //    so saveOwnerGstCredentials can resolve the connectedAdvisorId
            const nowStr = new Date().toISOString();
            await db.prepare(`
                INSERT INTO ca_invitations (sender_id, receiver_id, sender_email, sender_name, receiver_email, status, created_at, updated_at)
                VALUES (1, 2, 'business@cliks.com', 'Acme Corp', 'ca@cliks.com', 'Accepted', ?, ?)
            `).run(nowStr, nowStr);

            // 1. Register client Acme Corp mapping User 1 (business owner) to User 2 (CA)
            //    Also set business_owner_id so credential lookup can find the owner
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

            // Set business_owner_id on the ca_clients record (normally done via acceptInvitation)
            await db.prepare("UPDATE ca_clients SET business_owner_id = 1 WHERE id = ?").run(clientId);

            // 2. Fetch GST status as CA (tokenUser2) -> should be 'Not Shared'
            const getStatusRes = await request(app)
                .get(`/api/v1/ca/clients/${clientId}/gst-status`)
                .set('Authorization', `Bearer ${tokenUser2}`);

            expect(getStatusRes.status).toBe(200);
            expect(getStatusRes.body.data.gstShareStatus).toBe('Not Shared');

            // 3. Request credentials as CA (tokenUser2)
            const requestCredsRes = await request(app)
                .post(`/api/v1/ca/clients/${clientId}/request-gst-credentials`)
                .set('Authorization', `Bearer ${tokenUser2}`);

            expect(requestCredsRes.status).toBe(200);

            // Verify status is now 'Requested'
            const getStatusRequestedRes = await request(app)
                .get(`/api/v1/ca/clients/${clientId}/gst-status`)
                .set('Authorization', `Bearer ${tokenUser2}`);

            expect(getStatusRequestedRes.status).toBe(200);
            expect(getStatusRequestedRes.body.data.gstShareStatus).toBe('Requested');

            // 4. Save GST credentials as the Business Owner (tokenUser1) without sharing (share: false)
            const saveResNoShare = await request(app)
                .post('/api/v1/ca/owner/gst-credentials')
                .set('Authorization', `Bearer ${tokenUser1}`)
                .send({
                    gstUsername: 'sanjay_gst_login@bnxmail.com',
                    gstPassword: 'SanjayGSTPass123!',
                    share: false
                });

            expect(saveResNoShare.status).toBe(200);

            // Fetch credentials as CA -> should return null values (still 'Requested')
            const getCaNoShareRes = await request(app)
                .get(`/api/v1/ca/clients/${clientId}/gst-credentials`)
                .set('Authorization', `Bearer ${tokenUser2}`);

            expect(getCaNoShareRes.status).toBe(200);
            expect(getCaNoShareRes.body.data.gstUsername).toBeNull();
            expect(getCaNoShareRes.body.data.gstPassword).toBeNull();

            // 5. Save and share GST credentials as the Business Owner (tokenUser1) (share: true)
            const saveResShare = await request(app)
                .post('/api/v1/ca/owner/gst-credentials')
                .set('Authorization', `Bearer ${tokenUser1}`)
                .send({
                    gstUsername: 'sanjay_gst_login@bnxmail.com',
                    gstPassword: 'SanjayGSTPass123!',
                    share: true
                });

            expect(saveResShare.status).toBe(200);

            // Verify password is encrypted in the database
            const dbUser = await db.prepare("SELECT gst_password FROM users WHERE email = 'business@cliks.com'").get();
            expect(dbUser.gst_password).not.toBe('SanjayGSTPass123!');
            expect(dbUser.gst_password).toContain(':');

            // 6. Fetch status as CA -> should be 'Shared'
            const getStatusSharedRes = await request(app)
                .get(`/api/v1/ca/clients/${clientId}/gst-status`)
                .set('Authorization', `Bearer ${tokenUser2}`);

            expect(getStatusSharedRes.status).toBe(200);
            expect(getStatusSharedRes.body.data.gstShareStatus).toBe('Shared');

            // Clear previous access logs
            await db.prepare("DELETE FROM ca_gst_access_logs").run();

            // 7. Fetch credentials as the authorized CA (tokenUser2) and confirm 'view' log is created
            const getCaRes = await request(app)
                .get(`/api/v1/ca/clients/${clientId}/gst-credentials`)
                .set('Authorization', `Bearer ${tokenUser2}`);

            expect(getCaRes.status).toBe(200);
            expect(getCaRes.body.data.gstUsername).toBe('sanjay_gst_login@bnxmail.com');
            expect(getCaRes.body.data.gstPassword).toBe('SanjayGSTPass123!');

            const logs = await db.prepare("SELECT * FROM ca_gst_access_logs WHERE client_id = ? AND action = 'view'").all(clientId);
            expect(logs.length).toBe(1);
            expect(logs[0].ca_user_id).toBe(2);

            // 8. Log an audit action copy_username as CA (tokenUser2)
            const logActionRes = await request(app)
                .post(`/api/v1/ca/clients/${clientId}/gst-audit`)
                .set('Authorization', `Bearer ${tokenUser2}`)
                .send({ action: 'copy_username' });

            expect(logActionRes.status).toBe(200);

            const actionLogs = await db.prepare("SELECT * FROM ca_gst_access_logs WHERE client_id = ? AND action = 'copy_username'").all(clientId);
            expect(actionLogs.length).toBe(1);

            // 9. Try to fetch as user who doesn't own the ca_clients record (tokenUser1) -> should fail (404)
            const unauthRes = await request(app)
                .get(`/api/v1/ca/clients/${clientId}/gst-credentials`)
                .set('Authorization', `Bearer ${tokenUser1}`);

            expect(unauthRes.status).toBe(404);

            // 10. Revoke credentials as Business Owner (tokenUser1)
            const revokeRes = await request(app)
                .delete('/api/v1/ca/owner/gst-credentials')
                .set('Authorization', `Bearer ${tokenUser1}`);

            expect(revokeRes.status).toBe(200);

            // 11. Fetch status again -> should be 'Revoked'
            const getStatusRevokedRes = await request(app)
                .get(`/api/v1/ca/clients/${clientId}/gst-status`)
                .set('Authorization', `Bearer ${tokenUser2}`);

            expect(getStatusRevokedRes.status).toBe(200);
            expect(getStatusRevokedRes.body.data.gstShareStatus).toBe('Revoked');

            // 12. Fetch credentials again as CA -> should return null values
            const getCaRevokedRes = await request(app)
                .get(`/api/v1/ca/clients/${clientId}/gst-credentials`)
                .set('Authorization', `Bearer ${tokenUser2}`);

            expect(getCaRevokedRes.status).toBe(200);
            expect(getCaRevokedRes.body.data.gstUsername).toBeNull();
            expect(getCaRevokedRes.body.data.gstPassword).toBeNull();
        });
    });
});

