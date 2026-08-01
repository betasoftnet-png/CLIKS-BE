const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const crypto = require('crypto');

const ENCRYPTION_KEY = crypto.createHash('sha256').update(process.env.GST_ENCRYPTION_KEY || 'cliks_gst_secret_key').digest();
const IV_LENGTH = 16;

function encrypt(text) {
    if (!text) return null;
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
    if (!text) return null;
    try {
        const textParts = text.split(':');
        const iv = Buffer.from(textParts.shift(), 'hex');
        const encryptedText = Buffer.from(textParts.join(':'), 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e) {
        console.error('Decryption failed:', e.message);
        return null;
    }
}

const initTableAndColumns = async () => {
    try {
        const dbType = process.env.DB_TYPE || 'sqlite';
        const idType = dbType === 'postgres' ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
        
        await db.prepare(`
            CREATE TABLE IF NOT EXISTS ca_audits (
                id ${idType},
                user_id INTEGER,
                compliance_score REAL,
                status TEXT,
                anomalies_found INTEGER,
                items_checked INTEGER,
                flagged_expenses TEXT,
                created_at TEXT
            )
        `).run();

        await db.prepare(`
            CREATE TABLE IF NOT EXISTS ca_invitations (
                id ${idType},
                sender_id INTEGER NOT NULL,
                sender_email TEXT,
                sender_name TEXT,
                receiver_email TEXT NOT NULL,
                status TEXT DEFAULT 'Pending',
                created_at TEXT,
                updated_at TEXT
            )
        `).run();

        await db.prepare(`
            CREATE TABLE IF NOT EXISTS ca_clients (
                id ${idType},
                ca_user_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                email TEXT,
                status TEXT,
                regime TEXT,
                income REAL,
                pending_filings INTEGER
            )
        `).run();

        await db.prepare(`
            CREATE TABLE IF NOT EXISTS ca_client_requests (
                id ${idType},
                ca_user_id INTEGER NOT NULL,
                client_name TEXT,
                title TEXT,
                description TEXT,
                status TEXT,
                due_date TEXT,
                priority TEXT,
                doc_type TEXT,
                attached_file TEXT
            )
        `).run();

        await db.prepare(`
            CREATE TABLE IF NOT EXISTS ca_tasks (
                id ${idType},
                ca_user_id INTEGER NOT NULL,
                client_name TEXT,
                title TEXT,
                status TEXT,
                priority TEXT,
                due_date TEXT
            )
        `).run();

        try { await db.prepare("ALTER TABLE ca_tasks ADD COLUMN ask_for_document INTEGER DEFAULT 0").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE ca_tasks ADD COLUMN attached_file TEXT").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE ca_invitations ADD COLUMN receiver_id INTEGER").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE ca_clients ADD COLUMN business_owner_id INTEGER").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE ca_tasks ADD COLUMN business_owner_id INTEGER").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE ca_tasks ADD COLUMN client_id INTEGER").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE users ADD COLUMN gst_username TEXT").run(); } catch(e) { console.error('users gst_username error:', e.message); }
        try { await db.prepare("ALTER TABLE users ADD COLUMN gst_password TEXT").run(); } catch(e) { console.error('users gst_password error:', e.message); }
        try { await db.prepare("ALTER TABLE users ADD COLUMN gst_share_status TEXT DEFAULT 'Not Shared'").run(); } catch(e) { console.error('users gst_share_status error:', e.message); }
        try { await db.prepare("ALTER TABLE ca_clients ADD COLUMN gst_share_status TEXT DEFAULT 'Not Shared'").run(); } catch(e) { console.error('ca_clients gst_share_status error:', e.message); }
        try { await db.prepare("ALTER TABLE ca_gst_access_logs ADD COLUMN action TEXT DEFAULT 'view'").run(); } catch(e) { console.error('ca_gst_access_logs action error:', e.message); }

        await db.prepare(`
            CREATE TABLE IF NOT EXISTS ca_gst_access_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ca_user_id INTEGER NOT NULL,
                client_id INTEGER NOT NULL,
                ca_name TEXT,
                client_name TEXT,
                accessed_at TEXT,
                ip_address TEXT
            )
        `).run();


        await db.prepare(`
            CREATE TABLE IF NOT EXISTS ca_timesheets (
                id ${idType},
                ca_user_id INTEGER NOT NULL,
                client_name TEXT,
                task_name TEXT,
                date TEXT,
                duration TEXT,
                billable INTEGER
            )
        `).run();

        await db.prepare(`
            CREATE TABLE IF NOT EXISTS ca_folders (
                id ${idType},
                ca_user_id INTEGER NOT NULL,
                name TEXT,
                count INTEGER
            )
        `).run();

        await db.prepare(`
            CREATE TABLE IF NOT EXISTS ca_files (
                id ${idType},
                ca_user_id INTEGER NOT NULL,
                name TEXT,
                size TEXT,
                folder_name TEXT,
                date TEXT
            )
        `).run();

        await db.prepare(`
            CREATE TABLE IF NOT EXISTS ca_team_members (
                id ${idType},
                ca_user_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                role TEXT,
                status TEXT DEFAULT 'Active'
            )
        `).run();

        await db.prepare(`
            CREATE TABLE IF NOT EXISTS ca_team_requests (
                id ${idType},
                ca_user_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                role TEXT,
                type TEXT,
                status TEXT DEFAULT 'Pending'
            )
        `).run();
    } catch (e) {
        console.error('[CA Dynamic Init Error]', e.message);
    }
};
initTableAndColumns();

const ensureSeededPracticeData = async (userId) => {
    try {
        // 1. Clients
        const clientCount = await db.prepare("SELECT COUNT(*) as count FROM ca_clients WHERE ca_user_id = ?").get(userId);
        if (clientCount.count === 0) {
            const defaultClients = [
                { name: 'Rohan Sharma', email: 'rohan.sharma@firm.com', status: 'Active', regime: 'New', income: 2450000, pending_filings: 0 },
                { name: 'Priya Patel (SME)', email: 'priya.patel@sme.com', status: 'Pending Filing', regime: 'New', income: 4800000, pending_filings: 1 },
                { name: 'Vikram Malhotra', email: 'vikram.malhotra@firm.com', status: 'Active', regime: 'Old', income: 1820000, pending_filings: 0 },
                { name: 'Aditya Birla Group (Individual)', email: 'aditya.birla@abg.com', status: 'Active', regime: 'New', income: 12500000, pending_filings: 0 },
                { name: 'Ananya Roy', email: 'ananya.roy@firm.com', status: 'Active', regime: 'New', income: 1550000, pending_filings: 0 }
            ];
            for (const c of defaultClients) {
                await db.prepare(`
                    INSERT INTO ca_clients (ca_user_id, name, email, status, regime, income, pending_filings)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `).run(userId, c.name, c.email, c.status, c.regime, c.income, c.pending_filings);
            }
        }

        // 2. Client Requests
        const requestCount = await db.prepare("SELECT COUNT(*) as count FROM ca_client_requests WHERE ca_user_id = ?").get(userId);
        if (requestCount.count === 0) {
            const defaultRequests = [
                { client_name: 'Priya Patel (SME)', title: 'Form 16 Q4 Upload', description: 'Please upload the employer issued Form 16 for Q4.', status: 'Awaiting Client', due_date: '2026-06-15', priority: 'High', doc_type: 'Form 16', attached_file: null },
                { client_name: 'Rohan Sharma', title: 'Q1 GST Purchase Ledger', description: 'Upload purchase bills and ledger for ITC reconciliation.', status: 'Under Review', due_date: '2026-06-05', priority: 'High', doc_type: 'Excel Ledger', attached_file: 'purchase_ledger_q1.xlsx' },
                { client_name: 'Ananya Roy', title: 'PAN & Aadhaar Scans', description: 'Required for updating filing profile.', status: 'Approved', due_date: '2026-05-30', priority: 'Medium', doc_type: 'KYC Scans', attached_file: 'kyc_docs_combined.pdf' },
                { client_name: 'Vikram Malhotra', title: 'Home Loan Interest Certificate', description: 'Certificate under Sec 24b for Old Regime exemption claims.', status: 'Awaiting Client', due_date: '2026-06-20', priority: 'Low', doc_type: 'Interest Cert', attached_file: null }
            ];
            for (const r of defaultRequests) {
                await db.prepare(`
                    INSERT INTO ca_client_requests (ca_user_id, client_name, title, description, status, due_date, priority, doc_type, attached_file)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(userId, r.client_name, r.title, r.description, r.status, r.due_date, r.priority, r.doc_type, r.attached_file);
            }
        }

        // 3. Tasks
        const taskCount = await db.prepare("SELECT COUNT(*) as count FROM ca_tasks WHERE ca_user_id = ?").get(userId);
        if (taskCount.count === 0) {
            const defaultTasks = [
                { client_name: 'Rohan Sharma', title: 'Draft ITR-1 Return', status: 'Pending', priority: 'High', due_date: '2026-06-10' },
                { client_name: 'Priya Patel (SME)', title: 'GSTIN Inward ITC Reconciliation', status: 'In Progress', priority: 'High', due_date: '2026-06-07' },
                { client_name: 'Vikram Malhotra', title: 'Verify TDS Forms 26AS & AIS', status: 'Completed', priority: 'Medium', due_date: '2026-05-20' },
                { client_name: 'Aditya Birla Group (Individual)', title: 'Compute Capital Gains', status: 'Pending', priority: 'Medium', due_date: '2026-06-18' },
                { client_name: 'Ananya Roy', title: 'Verify Sec 80C Investment Receipts', status: 'In Progress', priority: 'Low', due_date: '2026-06-12' }
            ];
            for (const t of defaultTasks) {
                await db.prepare(`
                    INSERT INTO ca_tasks (ca_user_id, client_name, title, status, priority, due_date)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).run(userId, t.client_name, t.title, t.status, t.priority, t.due_date);
            }
        }

        // 4. Timesheets
        const timesheetCount = await db.prepare("SELECT COUNT(*) as count FROM ca_timesheets WHERE ca_user_id = ?").get(userId);
        if (timesheetCount.count === 0) {
            const defaultTimesheets = [
                { client_name: 'Rohan Sharma', task_name: 'ITR-1 Draft Verification', date: '2026-05-20', duration: '01:45:00', billable: 1 },
                { client_name: 'Priya Patel (SME)', task_name: 'GSTR-3B Filing Preparation', date: '2026-05-19', duration: '02:30:00', billable: 1 },
                { client_name: 'Vikram Malhotra', task_name: 'TDS AIS Review', date: '2026-05-18', duration: '00:50:00', billable: 0 },
                { client_name: 'Ananya Roy', task_name: 'Advisory Consultation', date: '2026-05-15', duration: '01:15:00', billable: 1 }
            ];
            for (const ts of defaultTimesheets) {
                await db.prepare(`
                    INSERT INTO ca_timesheets (ca_user_id, client_name, task_name, date, duration, billable)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).run(userId, ts.client_name, ts.task_name, ts.date, ts.duration, ts.billable);
            }
        }

        // 5. Folders
        const folderCount = await db.prepare("SELECT COUNT(*) as count FROM ca_folders WHERE ca_user_id = ?").get(userId);
        if (folderCount.count === 0) {
            const defaultFolders = [
                { name: 'ITR Filings FY2025-26', count: 8 },
                { name: 'GST Registers & Computations', count: 14 },
                { name: 'KYC & Client PAN Vault', count: 5 },
                { name: 'TDS Certificates & AIS Forms', count: 11 }
            ];
            for (const f of defaultFolders) {
                await db.prepare(`
                    INSERT INTO ca_folders (ca_user_id, name, count)
                    VALUES (?, ?, ?)
                `).run(userId, f.name, f.count);
            }
        }

        // 6. Files
        const fileCount = await db.prepare("SELECT COUNT(*) as count FROM ca_files WHERE ca_user_id = ?").get(userId);
        if (fileCount.count === 0) {
            const defaultFiles = [
                { name: 'itr1_rohan_sharma_draft.xml', size: '42 KB', folder_name: 'ITR Filings FY2025-26', date: '2026-05-20' },
                { name: 'gst_inward_itc_priya_q1.xlsx', size: '2.8 MB', folder_name: 'GST Registers & Computations', date: '2026-05-19' },
                { name: 'pan_card_ananya_roy.pdf', size: '1.2 MB', folder_name: 'KYC & Client PAN Vault', date: '2026-05-15' },
                { name: 'interest_cert_vikram_24b.pdf', size: '950 KB', folder_name: 'TDS Certificates & AIS Forms', date: '2026-05-18' }
            ];
            for (const f of defaultFiles) {
                await db.prepare(`
                    INSERT INTO ca_files (ca_user_id, name, size, folder_name, date)
                    VALUES (?, ?, ?, ?, ?)
                `).run(userId, f.name, f.size, f.folder_name, f.date);
            }
        }

        // 7. Team Members
        const memberCount = await db.prepare("SELECT COUNT(*) as count FROM ca_team_members WHERE ca_user_id = ?").get(userId);
        if (memberCount.count === 0) {
            const defaultMembers = [
                { name: 'Vikram Malhotra', email: 'vikram.malhotra@firm.com', role: 'Partner / Senior CA', status: 'Active' },
                { name: 'Ananya Roy', email: 'ananya.roy@firm.com', role: 'Tax Associate', status: 'Active' },
                { name: 'Rohan Sharma', email: 'rohan.sharma@firm.com', role: 'Audit Lead', status: 'Active' }
            ];
            for (const m of defaultMembers) {
                await db.prepare(`
                    INSERT INTO ca_team_members (ca_user_id, name, email, role, status)
                    VALUES (?, ?, ?, ?, ?)
                `).run(userId, m.name, m.email, m.role, m.status);
            }
        }

        // 8. Team Requests
        const teamReqCount = await db.prepare("SELECT COUNT(*) as count FROM ca_team_requests WHERE ca_user_id = ?").get(userId);
        if (teamReqCount.count === 0) {
            const defaultRequests = [
                { name: 'Amit Patel', email: 'amit.patel@firm.com', role: 'CS Specialist', type: 'Incoming', status: 'Pending' },
                { name: 'Sneha Reddy', email: 'sneha.reddy@firm.com', role: 'Audit Intern', type: 'Outgoing', status: 'Pending' }
            ];
            for (const r of defaultRequests) {
                await db.prepare(`
                    INSERT INTO ca_team_requests (ca_user_id, name, email, role, type, status)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).run(userId, r.name, r.email, r.role, r.type, r.status);
            }
        }

        // Seed/ensure sanjay123@bnxmail.com and test users exist with GST credentials
        const sanjayUser = await db.prepare("SELECT * FROM users WHERE LOWER(email) = 'sanjay123@bnxmail.com'").get();
        const nowStr = new Date().toISOString();
        if (sanjayUser) {
            await db.prepare(`
                UPDATE users 
                SET gst_username = COALESCE(gst_username, 'sanjay_gst_login@bnxmail.com'),
                    gst_password = COALESCE(gst_password, 'SanjayGSTPass123!')
                WHERE LOWER(email) = 'sanjay123@bnxmail.com'
            `).run();
        } else {
            await db.prepare(`
                INSERT INTO users (username, email, password_hash, role, business_name, gst_username, gst_password, created_at, updated_at)
                VALUES ('sanjay123', 'sanjay123@bnxmail.com', 'hashedpassword', 'business', 'Sanjay Enterprises', 'sanjay_gst_login@bnxmail.com', 'SanjayGSTPass123!', ?, ?)
            `).run(nowStr, nowStr);
        }

        const testBusinessUser = await db.prepare("SELECT * FROM users WHERE LOWER(email) = 'business@cliks.com'").get();
        if (testBusinessUser) {
            await db.prepare(`
                UPDATE users 
                SET gst_username = COALESCE(gst_username, 'business_gst@cliks.com'),
                    gst_password = COALESCE(gst_password, 'AcmeGSTPass123!')
                WHERE LOWER(email) = 'business@cliks.com'
            `).run();
        }
    } catch (err) {
        console.error('[ensureSeededPracticeData Error]', err.message);
    }
};

const caController = {
    runComplianceScan: async (req, res) => {
        try {
            const now = new Date().toISOString();
            
            // Fetch live records to scan
            const expensesList = await db.prepare("SELECT * FROM expenses WHERE user_id = ?").all(req.user.id);
            const gstInvoices = await db.prepare("SELECT * FROM gst_invoices WHERE user_id = ?").all(req.user.id);
            
            const totalRecords = expensesList.length + gstInvoices.length;
            const itemsChecked = totalRecords;
            
            const flaggedExpenses = [];
            
            // Rule 1: Suspicious transactions / AML - Transfers over 1,00,000 INR
            for (const exp of expensesList) {
                const amt = parseFloat(exp.amount || exp.expense_amount || 0);
                if (amt > 100000) {
                    flaggedExpenses.push({
                        id: `exp-${exp.id}`,
                        desc: exp.description || exp.notes || `Suspiciously large transfer under ${exp.category_name || 'Expenses'}`,
                        amount: `₹${amt.toLocaleString()}`,
                        type: "High Risk AML Alert"
                    });
                }
            }

            // Rule 2: GST mismatch or missing GST numbers
            for (const inv of gstInvoices) {
                const amt = parseFloat(inv.amount || inv.invoice_amount || 0);
                if (!inv.vendor_gstin && inv.is_reconciliation === 'true') {
                    flaggedExpenses.push({
                        id: `inv-${inv.id}`,
                        desc: `Missing vendor GSTIN for ${inv.vendor_name || inv.client_name || 'Vendor'}`,
                        amount: `₹${amt.toLocaleString()}`,
                        type: "GST Compliance Mismatch"
                    });
                }
            }

            const anomaliesFound = flaggedExpenses.length;
            const score = Math.max(70, 100 - anomaliesFound * 4.5);
            const compliance_score = parseFloat(score.toFixed(1));
            const status = compliance_score >= 90 ? "Compliant" : "Needs Review";


            // Store scan in the database
            await db.prepare(`
                INSERT INTO ca_audits (user_id, compliance_score, status, anomalies_found, items_checked, flagged_expenses, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
                req.user.id, compliance_score, status, anomaliesFound, itemsChecked, JSON.stringify(flaggedExpenses), now
            );

            return sendSuccess(res, {
                compliance: compliance_score,
                issues: anomaliesFound,
                status,
                itemsChecked,
                flaggedExpenses
            }, 'Compliance scan completed successfully');
        } catch (error) {
            console.error('[CA Compliance Scan Error]', error);
            return sendError(res, 'Compliance scan failed', 500);
        }
    },

    getScanHistory: async (req, res) => {
        try {
            const list = await db.prepare("SELECT * FROM ca_audits WHERE user_id = ? ORDER BY id DESC").all(req.user.id);
            return sendSuccess(res, list.map(item => ({
                ...item,
                flagged_expenses: JSON.parse(item.flagged_expenses)
            })), 'Scan history retrieved');
        } catch (error) {
            return sendError(res, 'Failed to fetch scan history', 500);
        }
    },

    applyCrossBorderAudit: async (req, res) => {
        const { standard } = req.body;
        try {
            const isGAAP = standard === 'US_GAAP';
            const rulesApplied = isGAAP 
                ? "LIFO allowed, Rules-based validation, Explicit segments disclosure active" 
                : "FIFO/Weighted average required, Principles-based fair value calculations applied";
            
            return sendSuccess(res, {
                standard,
                rulesApplied,
                timestamp: new Date().toISOString()
            }, `Audited transaction records successfully using ${standard}`);
        } catch (error) {
            return sendError(res, 'Audit failed', 500);
        }
    },

    sendInvitation: async (req, res) => {
        const { email } = req.body;
        if (!email || !email.includes('@')) {
            return sendError(res, 'Valid receiver email is required', 400);
        }
        
        try {
            // Check self-invitation
            if (req.user.email && req.user.email.toLowerCase() === email.toLowerCase()) {
                return sendError(res, 'You cannot invite yourself as a CA', 400);
            }

            // Check if there is already a pending or accepted invitation
            const existing = await db.prepare(`
                SELECT * FROM ca_invitations 
                WHERE sender_id = ? AND LOWER(receiver_email) = LOWER(?)
            `).get(req.user.id, email);

            if (existing) {
                if (existing.status === 'Accepted') {
                    return sendError(res, 'You are already connected to this CA', 400);
                } else if (existing.status === 'Pending') {
                    return sendError(res, 'An invitation is already pending for this CA', 400);
                }
            }

            // Look up CA ID
            const caUser = await db.prepare("SELECT id FROM users WHERE LOWER(email) = LOWER(?)").get(email);
            const receiverId = caUser ? caUser.id : null;

            // Get sender name / business name from users table
            const sender = await db.prepare("SELECT username, email, business_name FROM users WHERE id = ?").get(req.user.id);
            const senderName = sender?.business_name || sender?.username || 'Cliks Business Client';
            const senderEmail = sender?.email || req.user.email;

            const now = new Date().toISOString();
            
            // Insert invitation
            const result = await db.prepare(`
                INSERT INTO ca_invitations (sender_id, receiver_id, sender_email, sender_name, receiver_email, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 'Pending', ?, ?)
            `).run(req.user.id, receiverId, senderEmail, senderName, email, now, now);

            const newInvite = {
                id: result.lastInsertRowid,
                sender_id: req.user.id,
                receiver_id: receiverId,
                sender_email: senderEmail,
                sender_name: senderName,
                receiver_email: email,
                status: 'Pending',
                created_at: now,
                updated_at: now
            };

            return sendSuccess(res, newInvite, 'Invitation sent successfully');
        } catch (error) {
            console.error('[CA Send Invitation Error]', error);
            return sendError(res, 'Failed to send invitation', 500);
        }
    },

    getOutgoingInvitations: async (req, res) => {
        try {
            const list = await db.prepare("SELECT * FROM ca_invitations WHERE sender_id = ? ORDER BY id DESC").all(req.user.id);
            return sendSuccess(res, list, 'Outgoing invitations retrieved');
        } catch (error) {
            console.error('[CA Get Outgoing Invitations Error]', error);
            return sendError(res, 'Failed to fetch outgoing invitations', 500);
        }
    },

    getIncomingInvitations: async (req, res) => {
        try {
            const email = req.user.email;
            if (!email) {
                return sendError(res, 'User email not found in session', 400);
            }
            // Get incoming invitations for the logged-in user
            const list = await db.prepare(`
                SELECT * FROM ca_invitations 
                WHERE LOWER(receiver_email) = LOWER(?) OR receiver_id = ?
                ORDER BY id DESC
            `).all(email, req.user.id);
            return sendSuccess(res, list, 'Incoming invitations retrieved');
        } catch (error) {
            console.error('[CA Get Incoming Invitations Error]', error);
            return sendError(res, 'Failed to fetch incoming invitations', 500);
        }
    },

    acceptInvitation: async (req, res) => {
        const { id } = req.params;
        try {
            const email = req.user.email;
            if (!email) {
                return sendError(res, 'User email not found in session', 400);
            }

            // Find invitation - verify that the logged-in user is indeed the receiver of this invitation
            const invitation = await db.prepare(`
                SELECT * FROM ca_invitations 
                WHERE id = ? AND (LOWER(receiver_email) = LOWER(?) OR receiver_id = ?)
            `).get(id, email, req.user.id);

            if (!invitation) {
                return sendError(res, 'Invitation not found or unauthorized', 404);
            }

            if (invitation.status === 'Accepted') {
                return sendSuccess(res, invitation, 'Invitation already accepted');
            }

            const now = new Date().toISOString();
            await db.prepare(`
                UPDATE ca_invitations 
                SET status = 'Accepted', updated_at = ? 
                WHERE id = ?
            `).run(now, id);

            // Find CA user to register the client under their ID (falls back to req.user.id if user does not exist)
            const caUser = await db.prepare("SELECT id FROM users WHERE LOWER(email) = LOWER(?)").get(invitation.receiver_email);
            const caUserId = caUser ? caUser.id : req.user.id;

            // Make sure receiver_id is set in the invitation record
            await db.prepare("UPDATE ca_invitations SET receiver_id = ? WHERE id = ?").run(caUserId, id);

            // Retrieve client user ID to calculate their actual gross income dynamically from transactions/invoices
            const clientUser = await db.prepare("SELECT id FROM users WHERE LOWER(email) = LOWER(?)").get(invitation.sender_email);
            const clientOwnerId = clientUser ? clientUser.id : null;

            let clientIncome = 0;
            if (clientUser) {
                const incomeResult = await db.prepare("SELECT SUM(amount) as total FROM income WHERE user_id = ?").get(clientUser.id);
                const billingResult = await db.prepare("SELECT SUM(total_amount) as total FROM business_invoices WHERE user_id = ?").get(clientUser.id);
                clientIncome = (parseFloat(incomeResult?.total) || 0) + (parseFloat(billingResult?.total) || 0);
            }
            if (!clientIncome) {
                // Return a realistic, pseudo-randomized default gross income between 15 Lakhs and 35 Lakhs using a stable seed (email length)
                const seedVal = (invitation.sender_email || 'client@business.com').length;
                clientIncome = 1500000 + (seedVal % 5) * 400000;
            }

            // Also insert into ca_clients physically so it shows up in their practice workspace database
            const clientExists = await db.prepare(`
                SELECT * FROM ca_clients 
                WHERE ca_user_id = ? AND LOWER(email) = LOWER(?)
            `).get(caUserId, invitation.sender_email);

            if (!clientExists) {
                await db.prepare(`
                    INSERT INTO ca_clients (ca_user_id, name, email, status, regime, income, pending_filings, business_owner_id)
                    VALUES (?, ?, ?, 'Active', 'New', ?, 0, ?)
                `).run(caUserId, invitation.sender_name || 'Cliks Business Client', invitation.sender_email, clientIncome, clientOwnerId);
            } else {
                await db.prepare(`
                    UPDATE ca_clients
                    SET business_owner_id = ?
                    WHERE id = ?
                `).run(clientOwnerId, clientExists.id);
            }

            const updatedInvite = {
                ...invitation,
                receiver_id: caUserId,
                status: 'Accepted',
                updated_at: now
            };

            return sendSuccess(res, updatedInvite, 'Invitation accepted successfully');
        } catch (error) {
            console.error('[CA Accept Invitation Error]', error);
            return sendError(res, 'Failed to accept invitation', 500);
        }
    },
    revokeInvitation: async (req, res) => {
        const { id } = req.params;
        try {
            await db.prepare("DELETE FROM ca_invitations WHERE id = ?").run(id);
            return sendSuccess(res, { id }, 'Invitation revoked or rejected successfully');
        } catch (error) {
            console.error('[CA Revoke Invitation Error]', error);
            return sendError(res, 'Failed to revoke invitation', 500);
        }
    },

    // --- NEW PRACTICE WORKSPACE ENDPOINTS ---
    getClients: async (req, res) => {
        try {
            await ensureSeededPracticeData(req.user.id);
            const list = await db.prepare("SELECT * FROM ca_clients WHERE ca_user_id = ? ORDER BY id DESC").all(req.user.id);
            return sendSuccess(res, list.map(item => ({
                id: item.id,
                name: item.name,
                email: item.email,
                status: item.status,
                regime: item.regime,
                income: item.income,
                pendingFilings: item.pending_filings
            })), 'Practice clients retrieved');
        } catch (error) {
            console.error('[CA getClients Error]', error);
            return sendError(res, 'Failed to fetch practice clients', 500);
        }
    },
    addClient: async (req, res) => {
        const { name, email, status, regime, income } = req.body;
        if (!name) return sendError(res, 'Client name is required', 400);
        try {
            const pending_filings = status === 'Active' ? 0 : 1;
            const result = await db.prepare(`
                INSERT INTO ca_clients (ca_user_id, name, email, status, regime, income, pending_filings)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(req.user.id, name, email || '', status || 'Active', regime || 'New', parseFloat(income) || 0, pending_filings);
            
            const newClient = {
                id: result.lastInsertRowid,
                ca_user_id: req.user.id,
                name,
                email,
                status: status || 'Active',
                regime: regime || 'New',
                income: parseFloat(income) || 0,
                pendingFilings: pending_filings
            };
            return sendSuccess(res, newClient, 'Client registered successfully');
        } catch (error) {
            console.error('[CA addClient Error]', error);
            return sendError(res, 'Failed to register client', 500);
        }
    },

    getRequests: async (req, res) => {
        try {
            await ensureSeededPracticeData(req.user.id);
            const list = await db.prepare("SELECT * FROM ca_client_requests WHERE ca_user_id = ? ORDER BY id DESC").all(req.user.id);
            const mapped = list.map(item => ({
                id: item.id,
                clientName: item.client_name,
                title: item.title,
                description: item.description,
                status: item.status,
                dueDate: item.due_date,
                priority: item.priority,
                docType: item.doc_type,
                attachedFile: item.attached_file
            }));
            return sendSuccess(res, mapped, 'Practice requests retrieved');
        } catch (error) {
            console.error('[CA getRequests Error]', error);
            return sendError(res, 'Failed to fetch practice requests', 500);
        }
    },
    addRequest: async (req, res) => {
        const { clientName, title, description, dueDate, priority, docType } = req.body;
        if (!title) return sendError(res, 'Request title is required', 400);
        try {
            const defaultDate = dueDate || new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().split('T')[0];
            const result = await db.prepare(`
                INSERT INTO ca_client_requests (ca_user_id, client_name, title, description, status, due_date, priority, doc_type, attached_file)
                VALUES (?, ?, ?, ?, 'Awaiting Client', ?, ?, ?, null)
            `).run(req.user.id, clientName || 'General Client', title, description || '', defaultDate, priority || 'Medium', docType || 'Form 16');
            
            const newRequest = {
                id: result.lastInsertRowid,
                clientName: clientName || 'General Client',
                title,
                description: description || '',
                status: 'Awaiting Client',
                dueDate: defaultDate,
                priority: priority || 'Medium',
                docType: docType || 'Form 16',
                attachedFile: null
            };
            return sendSuccess(res, newRequest, 'Request issued successfully');
        } catch (error) {
            console.error('[CA addRequest Error]', error);
            return sendError(res, 'Failed to issue request', 500);
        }
    },
    uploadRequestDoc: async (req, res) => {
        const { id } = req.params;
        try {
            const requestRecord = await db.prepare("SELECT * FROM ca_client_requests WHERE id = ? AND ca_user_id = ?").get(id, req.user.id);
            if (!requestRecord) return sendError(res, 'Request not found', 404);

            const docTypeNormalized = (requestRecord.doc_type || 'doc').toLowerCase().replace(/\s+/g, '_');
            const attachedFile = `simulated_upload_${docTypeNormalized}_${Date.now().toString().slice(-4)}.pdf`;
            
            await db.prepare(`
                UPDATE ca_client_requests 
                SET status = 'Under Review', attached_file = ? 
                WHERE id = ?
            `).run(attachedFile, id);

            return sendSuccess(res, { id: parseInt(id), status: 'Under Review', attachedFile }, 'Document uploaded successfully');
        } catch (error) {
            console.error('[CA uploadRequestDoc Error]', error);
            return sendError(res, 'Failed to upload document', 500);
        }
    },
    approveRequestDoc: async (req, res) => {
        const { id } = req.params;
        try {
            await db.prepare(`
                UPDATE ca_client_requests 
                SET status = 'Approved' 
                WHERE id = ? AND ca_user_id = ?
            `).run(id, req.user.id);
            return sendSuccess(res, { id: parseInt(id), status: 'Approved' }, 'Document approved successfully');
        } catch (error) {
            console.error('[CA approveRequestDoc Error]', error);
            return sendError(res, 'Failed to approve document', 500);
        }
    },

    getTasks: async (req, res) => {
        try {
            await ensureSeededPracticeData(req.user.id);
            const email = req.user.email || '';
            
            // Find all client records in ca_clients where client email is this user's email
            const clientRecords = await db.prepare("SELECT id FROM ca_clients WHERE LOWER(email) = LOWER(?)").all(email);
            const clientIds = clientRecords.map(r => r.id);

            let list;
            if (clientIds.length > 0) {
                const placeholders = clientIds.map(() => '?').join(',');
                list = await db.prepare(`
                    SELECT * FROM ca_tasks 
                    WHERE ca_user_id = ? 
                       OR client_id IN (${placeholders}) 
                       OR business_owner_id = ? 
                       OR LOWER(client_name) = LOWER(?)
                    ORDER BY id DESC
                `).all(req.user.id, ...clientIds, req.user.id, email);
            } else {
                list = await db.prepare(`
                    SELECT * FROM ca_tasks 
                    WHERE ca_user_id = ? OR business_owner_id = ? OR LOWER(client_name) = LOWER(?)
                    ORDER BY id DESC
                `).all(req.user.id, req.user.id, email);
            }

            const mapped = list.map(item => ({
                id: item.id,
                clientName: item.client_name,
                title: item.title,
                status: item.status,
                priority: item.priority,
                dueDate: item.due_date,
                askForDocument: item.ask_for_document == 1 || item.ask_for_document === 'true' || item.ask_for_document === true,
                attachedFile: item.attached_file,
                businessOwnerId: item.business_owner_id,
                clientId: item.client_id
            }));
            return sendSuccess(res, mapped, 'Practice tasks retrieved');
        } catch (error) {
            console.error('[CA getTasks Error]', error);
            return sendError(res, 'Failed to fetch practice tasks', 500);
        }
    },
    addTask: async (req, res) => {
        const { clientName, title, priority, dueDate, askForDocument } = req.body;
        if (!title) return sendError(res, 'Task title is required', 400);
        try {
            const defaultDate = dueDate || new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString().split('T')[0];
            const askDocInt = (askForDocument === 'true' || askForDocument === true || askForDocument == 1) ? 1 : 0;

            // Find client in ca_clients for this CA
            const client = await db.prepare(`
                SELECT * FROM ca_clients 
                WHERE ca_user_id = ? AND (LOWER(name) = LOWER(?) OR LOWER(email) = LOWER(?))
            `).get(req.user.id, clientName, clientName);

            let businessOwnerId = null;
            let clientId = null;
            if (client) {
                clientId = client.id;
                businessOwnerId = client.business_owner_id;
                if (!businessOwnerId && client.email) {
                    const owner = await db.prepare("SELECT id FROM users WHERE LOWER(email) = LOWER(?)").get(client.email);
                    if (owner) {
                        businessOwnerId = owner.id;
                    }
                }
            } else {
                // If client not in ca_clients, check if clientName is the email of a user
                const owner = await db.prepare("SELECT id FROM users WHERE LOWER(email) = LOWER(?)").get(clientName);
                if (owner) {
                    businessOwnerId = owner.id;
                }
            }

            const result = await db.prepare(`
                INSERT INTO ca_tasks (ca_user_id, client_name, title, status, priority, due_date, ask_for_document, attached_file, business_owner_id, client_id)
                VALUES (?, ?, ?, 'Pending', ?, ?, ?, null, ?, ?)
            `).run(req.user.id, clientName || 'General Client', title, priority || 'Medium', defaultDate, askDocInt, businessOwnerId, clientId);

            const taskId = result.lastInsertRowid;

            // Notify Business Owner if they exist
            if (businessOwnerId) {
                const now = new Date().toISOString();
                const messageText = `Your FIN-PRO Advisor has assigned a new compliance task: "${title}".`;
                await db.prepare(`
                    INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
                    VALUES (?, ?, ?, 'Info', 0, ?)
                `).run(businessOwnerId, 'New Task Assigned', messageText, now);
            }

            const newTask = {
                id: taskId,
                clientName: clientName || 'General Client',
                title,
                status: 'Pending',
                priority: priority || 'Medium',
                dueDate: defaultDate,
                askForDocument: !!askForDocument,
                attachedFile: null,
                businessOwnerId,
                clientId
            };
            return sendSuccess(res, newTask, 'Task added successfully');
        } catch (error) {
            console.error('[CA addTask Error]', error);
            return sendError(res, 'Failed to add task', 500);
        }
    },
    toggleTaskStatus: async (req, res) => {
        const { id } = req.params;
        try {
            const email = req.user.email || '';
            
            // Find all client records in ca_clients where client email is this user's email
            const clientRecords = await db.prepare("SELECT id FROM ca_clients WHERE LOWER(email) = LOWER(?)").all(email);
            const clientIds = clientRecords.map(r => r.id);

            let task;
            if (clientIds.length > 0) {
                const placeholders = clientIds.map(() => '?').join(',');
                task = await db.prepare(`
                    SELECT * FROM ca_tasks 
                    WHERE id = ? AND (ca_user_id = ? OR client_id IN (${placeholders}) OR business_owner_id = ? OR LOWER(client_name) = LOWER(?))
                `).get(id, req.user.id, ...clientIds, req.user.id, email);
            } else {
                task = await db.prepare(`
                    SELECT * FROM ca_tasks 
                    WHERE id = ? AND (ca_user_id = ? OR business_owner_id = ? OR LOWER(client_name) = LOWER(?))
                `).get(id, req.user.id, req.user.id, email);
            }

            if (!task) return sendError(res, 'Task not found or unauthorized', 404);

            let nextStatus;
            if (task.status === 'Pending') {
                nextStatus = 'In Progress';
            } else if (task.status === 'In Progress') {
                nextStatus = 'Completed';
            } else if (task.status === 'Uploaded') {
                nextStatus = 'Verified';
            } else if (task.status === 'Verified') {
                nextStatus = 'Completed';
            } else {
                nextStatus = 'Pending';
            }

            await db.prepare("UPDATE ca_tasks SET status = ? WHERE id = ?").run(nextStatus, id);

            return sendSuccess(res, { id: parseInt(id), status: nextStatus }, 'Task status updated');
        } catch (error) {
            console.error('[CA toggleTaskStatus Error]', error);
            return sendError(res, 'Failed to update task status', 500);
        }
    },
    uploadTaskDoc: async (req, res) => {
        const { id } = req.params;
        try {
            const attachedFile = `uploaded_task_doc_${Date.now().toString().slice(-4)}.pdf`;
            
            await db.prepare(`
                UPDATE ca_tasks 
                SET attached_file = ?, status = 'Uploaded' 
                WHERE id = ?
            `).run(attachedFile, id);

            // Fetch the updated task to notify the CA
            const task = await db.prepare("SELECT * FROM ca_tasks WHERE id = ?").get(id);
            if (task && task.ca_user_id) {
                const now = new Date().toISOString();
                const senderName = task.client_name || 'Client';
                const messageText = `Client ${senderName} has uploaded a document for compliance task: "${task.title}".`;
                await db.prepare(`
                    INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
                    VALUES (?, ?, ?, 'Info', 0, ?)
                `).run(task.ca_user_id, 'Document Uploaded', messageText, now);
            }

            return sendSuccess(res, { id: parseInt(id), status: 'Uploaded', attachedFile }, 'Task document uploaded successfully');
        } catch (error) {
            console.error('[CA uploadTaskDoc Error]', error);
            return sendError(res, 'Failed to upload task document', 500);
        }
    },

    getTimesheets: async (req, res) => {
        try {
            await ensureSeededPracticeData(req.user.id);
            const list = await db.prepare("SELECT * FROM ca_timesheets WHERE ca_user_id = ? ORDER BY id DESC").all(req.user.id);
            const mapped = list.map(item => ({
                id: item.id,
                clientName: item.client_name,
                taskName: item.task_name,
                date: item.date,
                duration: item.duration,
                billable: item.billable === 1
            }));
            return sendSuccess(res, mapped, 'Timesheets retrieved');
        } catch (error) {
            console.error('[CA getTimesheets Error]', error);
            return sendError(res, 'Failed to fetch timesheets', 500);
        }
    },
    addTimesheet: async (req, res) => {
        const { clientName, taskName, date, duration, billable } = req.body;
        try {
            const result = await db.prepare(`
                INSERT INTO ca_timesheets (ca_user_id, client_name, task_name, date, duration, billable)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(req.user.id, clientName || 'General Client', taskName || 'Consultation Session', date || new Date().toISOString().split('T')[0], duration || '00:00:00', billable ? 1 : 0);

            const newSession = {
                id: result.lastInsertRowid,
                clientName: clientName || 'General Client',
                taskName: taskName || 'Consultation Session',
                date: date || new Date().toISOString().split('T')[0],
                duration: duration || '00:00:00',
                billable: !!billable
            };
            return sendSuccess(res, newSession, 'Timesheet session saved');
        } catch (error) {
            console.error('[CA addTimesheet Error]', error);
            return sendError(res, 'Failed to save timesheet session', 500);
        }
    },

    getFolders: async (req, res) => {
        try {
            await ensureSeededPracticeData(req.user.id);
            const list = await db.prepare("SELECT * FROM ca_folders WHERE ca_user_id = ? ORDER BY id ASC").all(req.user.id);
            return sendSuccess(res, list, 'Folders retrieved');
        } catch (error) {
            console.error('[CA getFolders Error]', error);
            return sendError(res, 'Failed to fetch folders', 500);
        }
    },
    getFiles: async (req, res) => {
        try {
            await ensureSeededPracticeData(req.user.id);
            const list = await db.prepare("SELECT * FROM ca_files WHERE ca_user_id = ? ORDER BY id DESC").all(req.user.id);
            const mapped = list.map(item => ({
                id: item.id,
                name: item.name,
                size: item.size,
                folderName: item.folder_name,
                date: item.date
            }));
            return sendSuccess(res, mapped, 'Files retrieved');
        } catch (error) {
            console.error('[CA getFiles Error]', error);
            return sendError(res, 'Failed to fetch files', 500);
        }
    },
    addFile: async (req, res) => {
        const { name, size, folderName, date } = req.body;
        if (!name) return sendError(res, 'File name is required', 400);
        try {
            const defaultDate = date || new Date().toISOString().split('T')[0];
            const defaultFolderName = folderName || 'ITR Filings FY2025-26';
            const result = await db.prepare(`
                INSERT INTO ca_files (ca_user_id, name, size, folder_name, date)
                VALUES (?, ?, ?, ?, ?)
            `).run(req.user.id, name, size || '1.0 MB', defaultFolderName, defaultDate);

            // Increment count in respective folder
            await db.prepare(`
                UPDATE ca_folders 
                SET count = count + 1 
                WHERE ca_user_id = ? AND name = ?
            `).run(req.user.id, defaultFolderName);

            const newFile = {
                id: result.lastInsertRowid,
                name,
                size: size || '1.0 MB',
                folderName: defaultFolderName,
                date: defaultDate
            };
            return sendSuccess(res, newFile, 'File uploaded successfully');
        } catch (error) {
            console.error('[CA addFile Error]', error);
            return sendError(res, 'Failed to upload file', 500);
        }
    },
    deleteFile: async (req, res) => {
        const { id } = req.params;
        try {
            const file = await db.prepare("SELECT * FROM ca_files WHERE id = ? AND ca_user_id = ?").get(id, req.user.id);
            if (file) {
                await db.prepare("DELETE FROM ca_files WHERE id = ?").run(id);
                await db.prepare(`
                    UPDATE ca_folders 
                    SET count = count - 1 
                    WHERE ca_user_id = ? AND name = ? AND count > 0
                `).run(req.user.id, file.folder_name);
            }
            return sendSuccess(res, { id: parseInt(id) }, 'File deleted successfully');
        } catch (error) {
            console.error('[CA deleteFile Error]', error);
            return sendError(res, 'Failed to delete file', 500);
        }
    },
    getTeamMembers: async (req, res) => {
        try {
            await ensureSeededPracticeData(req.user.id);
            const list = await db.prepare("SELECT * FROM ca_team_members WHERE ca_user_id = ? ORDER BY id DESC").all(req.user.id);
            return sendSuccess(res, list, 'Team members retrieved');
        } catch (error) {
            console.error('[CA getTeamMembers Error]', error);
            return sendError(res, 'Failed to fetch team members', 500);
        }
    },
    removeTeamMember: async (req, res) => {
        const { id } = req.params;
        try {
            await db.prepare("DELETE FROM ca_team_members WHERE id = ? AND ca_user_id = ?").run(id, req.user.id);
            return sendSuccess(res, { id: parseInt(id) }, 'Team member removed successfully');
        } catch (error) {
            console.error('[CA removeTeamMember Error]', error);
            return sendError(res, 'Failed to remove team member', 500);
        }
    },
    getTeamRequests: async (req, res) => {
        try {
            await ensureSeededPracticeData(req.user.id);
            const list = await db.prepare("SELECT * FROM ca_team_requests WHERE ca_user_id = ? ORDER BY id DESC").all(req.user.id);
            return sendSuccess(res, list, 'Team requests retrieved');
        } catch (error) {
            console.error('[CA getTeamRequests Error]', error);
            return sendError(res, 'Failed to fetch team requests', 500);
        }
    },
    addTeamRequest: async (req, res) => {
        const { email, role } = req.body;
        if (!email) return sendError(res, 'Email address is required', 400);
        const emailLower = email.trim().toLowerCase();

        // Check self-request
        if (req.user.email && req.user.email.toLowerCase() === emailLower) {
            return sendError(res, 'You cannot send a team invitation to yourself.', 400);
        }
        
        try {
            await ensureSeededPracticeData(req.user.id);
            
            // Check if already a member
            const memberExists = await db.prepare("SELECT * FROM ca_team_members WHERE ca_user_id = ? AND LOWER(email) = ?").get(req.user.id, emailLower);
            if (memberExists) {
                return sendError(res, 'This user is already a member of your team.', 400);
            }
            
            // Check if already requested (outgoing pending)
            const requestExists = await db.prepare("SELECT * FROM ca_team_requests WHERE ca_user_id = ? AND LOWER(email) = ? AND type = 'Outgoing'").get(req.user.id, emailLower);
            if (requestExists) {
                return sendError(res, 'An invitation has already been sent or is pending for this user.', 400);
            }
            
            // Fetch Sender User details
            const senderUser = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
            
            // Check if Receiver User exists in users table
            const receiverUser = await db.prepare("SELECT * FROM users WHERE LOWER(email) = ?").get(emailLower);
            
            const username = emailLower.split('@')[0];
            const formattedName = (receiverUser && (receiverUser.business_name || receiverUser.username)) || username
                .split('.')
                .map(part => part.charAt(0).toUpperCase() + part.slice(1))
                .join(' ') || 'External Consultant';
            
            const reqRole = role || 'Senior Tax Consultant';
            
            // 1. Insert OUTGOING request for Sender
            const result = await db.prepare(`
                INSERT INTO ca_team_requests (ca_user_id, name, email, role, type, status)
                VALUES (?, ?, ?, ?, 'Outgoing', 'Pending')
            `).run(req.user.id, formattedName, emailLower, reqRole);
            
            // 2. Insert INCOMING request for Receiver if they exist in the system
            if (receiverUser) {
                const senderName = senderUser.business_name || senderUser.username || senderUser.email.split('@')[0]
                    .split('.')
                    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
                    .join(' ') || 'Practice Member';
                
                await db.prepare(`
                    INSERT INTO ca_team_requests (ca_user_id, name, email, role, type, status)
                    VALUES (?, ?, ?, ?, 'Incoming', 'Pending')
                `).run(receiverUser.id, senderName, senderUser.email, reqRole);
            }
            
            const newReq = {
                id: result.lastInsertRowid,
                name: formattedName,
                email: emailLower,
                role: reqRole,
                type: 'Outgoing',
                status: 'Pending'
            };
            return sendSuccess(res, newReq, 'Team invitation sent successfully');
        } catch (error) {
            console.error('[CA addTeamRequest Error]', error);
            return sendError(res, 'Failed to send team invitation', 500);
        }
    },
    acceptTeamRequest: async (req, res) => {
        const { id } = req.params;
        try {
            await ensureSeededPracticeData(req.user.id);
            
            // Fetch the incoming request for B
            const incomingReq = await db.prepare("SELECT * FROM ca_team_requests WHERE id = ? AND ca_user_id = ?").get(id, req.user.id);
            if (!incomingReq) {
                return sendError(res, 'Team request not found', 404);
            }
            
            const senderUser = await db.prepare("SELECT * FROM users WHERE LOWER(email) = ?").get(incomingReq.email.toLowerCase());
            const receiverUser = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
            
            const senderName = (senderUser && (senderUser.business_name || senderUser.username)) || incomingReq.name;
            const senderEmail = (senderUser && senderUser.email) || incomingReq.email;
            
            // 1. Add Sender A as team member in B's team
            const result = await db.prepare(`
                INSERT INTO ca_team_members (ca_user_id, name, email, role, status)
                VALUES (?, ?, ?, ?, 'Active')
            `).run(receiverUser.id, senderName, senderEmail, incomingReq.role);
            
            // 2. Add Receiver B as team member in A's team (if Sender A exists)
            if (senderUser) {
                const receiverName = receiverUser.business_name || receiverUser.username || receiverUser.email.split('@')[0];
                await db.prepare(`
                    INSERT INTO ca_team_members (ca_user_id, name, email, role, status)
                    VALUES (?, ?, ?, ?, 'Active')
                `).run(senderUser.id, receiverName, receiverUser.email, incomingReq.role);
            }
            
            // 3. Delete B's incoming request
            await db.prepare("DELETE FROM ca_team_requests WHERE id = ?").run(id);
            
            // 4. Delete A's outgoing request (if Sender A exists)
            if (senderUser) {
                await db.prepare("DELETE FROM ca_team_requests WHERE ca_user_id = ? AND LOWER(email) = ? AND type = 'Outgoing'").run(senderUser.id, receiverUser.email.toLowerCase());
            }
            
            const newMember = {
                id: result.lastInsertRowid,
                name: senderName,
                email: senderEmail,
                role: incomingReq.role,
                status: 'Active'
            };
            
            return sendSuccess(res, { newMember, requestId: parseInt(id) }, 'Team request accepted');
        } catch (error) {
            console.error('[CA acceptTeamRequest Error]', error);
            return sendError(res, 'Failed to accept team request', 500);
        }
    },
    rejectTeamRequest: async (req, res) => {
        const { id } = req.params;
        try {
            await ensureSeededPracticeData(req.user.id);
            
            const incomingReq = await db.prepare("SELECT * FROM ca_team_requests WHERE id = ? AND ca_user_id = ?").get(id, req.user.id);
            if (incomingReq) {
                const senderUser = await db.prepare("SELECT * FROM users WHERE LOWER(email) = ?").get(incomingReq.email.toLowerCase());
                const receiverUser = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
                
                // Delete incoming request
                await db.prepare("DELETE FROM ca_team_requests WHERE id = ?").run(id);
                
                // Delete outgoing request from A's database
                if (senderUser) {
                    await db.prepare("DELETE FROM ca_team_requests WHERE ca_user_id = ? AND LOWER(email) = ? AND type = 'Outgoing'").run(senderUser.id, receiverUser.email.toLowerCase());
                }
            }
            return sendSuccess(res, { id: parseInt(id) }, 'Team request rejected/declined');
        } catch (error) {
            console.error('[CA rejectTeamRequest Error]', error);
            return sendError(res, 'Failed to reject team request', 500);
        }
    },
    cancelTeamRequest: async (req, res) => {
        const { id } = req.params;
        try {
            await ensureSeededPracticeData(req.user.id);
            
            const outgoingReq = await db.prepare("SELECT * FROM ca_team_requests WHERE id = ? AND ca_user_id = ?").get(id, req.user.id);
            if (outgoingReq) {
                const receiverUser = await db.prepare("SELECT * FROM users WHERE LOWER(email) = ?").get(outgoingReq.email.toLowerCase());
                const senderUser = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
                
                // Delete A's outgoing request
                await db.prepare("DELETE FROM ca_team_requests WHERE id = ?").run(id);
                
                // Delete B's incoming request
                if (receiverUser) {
                    await db.prepare("DELETE FROM ca_team_requests WHERE ca_user_id = ? AND LOWER(email) = ? AND type = 'Incoming'").run(receiverUser.id, senderUser.email.toLowerCase());
                }
            }
            return sendSuccess(res, { id: parseInt(id) }, 'Team request cancelled');
        } catch (error) {
            console.error('[CA cancelTeamRequest Error]', error);
            return sendError(res, 'Failed to cancel team request', 500);
        }
    },
    getClientDocuments: async (req, res) => {
        const { id } = req.params;
        try {
            const client = await db.prepare("SELECT * FROM ca_clients WHERE id = ? AND ca_user_id = ?").get(id, req.user.id);
            if (!client) {
                return sendError(res, 'Client not found', 404);
            }

            const clientUser = await db.prepare("SELECT * FROM users WHERE LOWER(email) = LOWER(?)").get(client.email);
            
            let allDocs = [];

            if (clientUser) {
                // 1. Fetch expenses/claims proof documents
                const expenses = await db.prepare("SELECT * FROM expenses WHERE user_id = ? AND is_claim = 'true'").all(clientUser.id);
                expenses.forEach(exp => {
                    let files = [];
                    if (exp.proof_files) {
                        try {
                            files = JSON.parse(exp.proof_files);
                        } catch (e) {}
                    }
                    if (!Array.isArray(files) || files.length === 0) {
                        if (exp.proof_file_path) {
                            files = [{
                                path: exp.proof_file_path,
                                name: exp.proof_file_name || 'Receipt',
                                type: exp.proof_file_type || 'Image',
                                timestamp: exp.proof_timestamp || exp.created_at
                            }];
                        }
                    }
                    files.forEach((file, fIdx) => {
                        const fileExt = (file.name || '').split('.').pop().toLowerCase();
                        const isPdf = fileExt === 'pdf' || (file.type || '').toLowerCase().includes('pdf');
                        allDocs.push({
                            id: `claim_${exp.id}_${fIdx}`,
                            source_table: 'expenses',
                            source_id: exp.id,
                            name: file.name || exp.proof_file_name || 'Receipt',
                            path: file.path || exp.proof_file_path,
                            type: isPdf ? 'PDF' : 'Image',
                            uploaded_by: exp.employee_name || client.name,
                            uploaded_at: file.timestamp || exp.proof_timestamp || exp.created_at || exp.date || '',
                            task_name: `Expense Claim: ${exp.travel_expense || 'Reimbursement'}`
                        });
                    });
                });

                // 2. Fetch GST Invoices LUT documents
                const gstInvoices = await db.prepare("SELECT * FROM gst_invoices WHERE user_id = ? AND lut_document_path IS NOT NULL").all(clientUser.id);
                gstInvoices.forEach(inv => {
                    allDocs.push({
                        id: `gst_${inv.id}`,
                        source_table: 'gst_invoices',
                        source_id: inv.id,
                        name: inv.lut_file_name || 'LUT Document',
                        path: inv.lut_document_path,
                        type: 'PDF',
                        uploaded_by: inv.lut_uploaded_by || client.name,
                        uploaded_at: inv.lut_uploaded_at || inv.created_at || inv.invoice_date || '',
                        task_name: `GST Invoice: ${inv.invoice_number} (Export Under LUT)`
                    });
                });
            }

            // 3. Fetch Client Requests with attached files
            const clientRequests = await db.prepare("SELECT * FROM ca_client_requests WHERE ca_user_id = ? AND (LOWER(client_name) = LOWER(?) OR LOWER(client_name) = LOWER(?)) AND attached_file IS NOT NULL").all(req.user.id, client.name, client.email || '');
            clientRequests.forEach(reqRec => {
                const fileExt = (reqRec.attached_file || '').split('.').pop().toLowerCase();
                const isPdf = fileExt === 'pdf' || (reqRec.doc_type || '').toLowerCase().includes('pdf');
                allDocs.push({
                    id: `request_${reqRec.id}`,
                    source_table: 'ca_client_requests',
                    source_id: reqRec.id,
                    name: reqRec.attached_file,
                    path: `/uploads/${reqRec.attached_file}`,
                    type: isPdf ? 'PDF' : 'Image',
                    uploaded_by: client.name,
                    uploaded_at: reqRec.updated_at || reqRec.created_at || reqRec.due_date || '',
                    task_name: `Client Request: ${reqRec.title}`
                });
            });

            // 4. Fetch Client Tasks with attached files
            const clientTasks = await db.prepare(`
                SELECT * FROM ca_tasks 
                WHERE ca_user_id = ? 
                  AND (client_id = ? OR LOWER(client_name) = LOWER(?) OR LOWER(client_name) = LOWER(?))
                  AND attached_file IS NOT NULL
            `).all(req.user.id, client.id, client.name, client.email || '');
            clientTasks.forEach(taskRec => {
                const fileExt = (taskRec.attached_file || '').split('.').pop().toLowerCase();
                const isPdf = fileExt === 'pdf';
                allDocs.push({
                    id: `task_${taskRec.id}`,
                    source_table: 'ca_tasks',
                    source_id: taskRec.id,
                    name: taskRec.attached_file,
                    path: `/uploads/${taskRec.attached_file}`,
                    type: isPdf ? 'PDF' : 'Image',
                    uploaded_by: client.name,
                    uploaded_at: taskRec.due_date || taskRec.created_at || '',
                    task_name: `Assigned Task: ${taskRec.title}`
                });
            });

            // 5. Fetch Reviews & Remarks
            const reviews = await db.prepare("SELECT * FROM ca_document_reviews WHERE ca_user_id = ? AND client_id = ?").all(req.user.id, client.id);
            const reviewsMap = {};
            reviews.forEach(r => {
                reviewsMap[r.document_id] = { status: r.status, remark: r.remark };
            });

            // Map all documents with review statuses
            const mappedDocs = allDocs.map(doc => {
                const rev = reviewsMap[doc.id] || {};
                return {
                    ...doc,
                    status: rev.status || 'Pending Review',
                    remark: rev.remark || ''
                };
            });

            return sendSuccess(res, mappedDocs, 'Client documents retrieved successfully');
        } catch (error) {
            console.error('[CA getClientDocuments Error]', error);
            return sendError(res, 'Failed to retrieve client documents', 500);
        }
    },
    updateClientDocumentReview: async (req, res) => {
        const { id: clientId } = req.params;
        const { documentId, status, remark } = req.body;
        if (!documentId) {
            return sendError(res, 'Document ID is required', 400);
        }
        try {
            const now = new Date().toISOString();
            
            // Map Approved status to Verified status
            const finalStatusVal = status === 'Approved' ? 'Verified' : status;

            const existing = await db.prepare("SELECT * FROM ca_document_reviews WHERE ca_user_id = ? AND client_id = ? AND document_id = ?").get(req.user.id, clientId, documentId);
            
            if (existing) {
                const finalStatus = finalStatusVal !== undefined ? finalStatusVal : existing.status;
                const finalRemark = remark !== undefined ? remark : existing.remark;
                await db.prepare(`
                    UPDATE ca_document_reviews 
                    SET status = ?, remark = ?, updated_at = ?
                    WHERE id = ?
                `).run(finalStatus, finalRemark, now, existing.id);
            } else {
                await db.prepare(`
                    INSERT INTO ca_document_reviews (ca_user_id, client_id, document_id, status, remark, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).run(req.user.id, clientId, documentId, finalStatusVal || 'Pending Review', remark || '', now);
            }

            // Sync status back to corresponding task/request tables if applicable
            if (finalStatusVal === 'Verified' || finalStatusVal === 'Approved') {
                if (documentId.startsWith('task_')) {
                    const taskId = documentId.split('_')[1];
                    await db.prepare("UPDATE ca_tasks SET status = 'Verified' WHERE id = ?").run(taskId);
                } else if (documentId.startsWith('request_')) {
                    const requestId = documentId.split('_')[1];
                    await db.prepare("UPDATE ca_client_requests SET status = 'Approved' WHERE id = ?").run(requestId);
                }
            } else if (finalStatusVal === 'Rejected') {
                if (documentId.startsWith('task_')) {
                    const taskId = documentId.split('_')[1];
                    await db.prepare("UPDATE ca_tasks SET status = 'Pending' WHERE id = ?").run(taskId);
                } else if (documentId.startsWith('request_')) {
                    const requestId = documentId.split('_')[1];
                    await db.prepare("UPDATE ca_client_requests SET status = 'Awaiting Client' WHERE id = ?").run(requestId);
                }
            }

            return sendSuccess(res, { documentId, status: finalStatusVal, remark }, 'Document review updated successfully');
        } catch (error) {
            console.error('[CA updateClientDocumentReview Error]', error);
            return sendError(res, 'Failed to update document review', 500);
        }
    },
    getClientGstCredentials: async (req, res) => {
        const { id: clientId } = req.params;
        try {
            if (req.user.role !== 'ca') {
                return sendError(res, 'Access denied. Advisor role required.', 403);
            }

            const client = await db.prepare("SELECT * FROM ca_clients WHERE id = ? AND ca_user_id = ?").get(clientId, req.user.id);
            if (!client) {
                return sendError(res, 'Client not found or unauthorized', 404);
            }

            let gstShareStatus = client.gst_share_status || 'Not Shared';
            let gstUsername = null;
            let encryptedPassword = null;

            if (client.business_owner_id) {
                const owner = await db.prepare("SELECT gst_username, gst_password, gst_share_status FROM users WHERE id = ?").get(client.business_owner_id);
                if (owner) {
                    gstShareStatus = owner.gst_share_status || 'Not Shared';
                    if (gstShareStatus === 'Shared') {
                        gstUsername = owner.gst_username;
                        encryptedPassword = owner.gst_password;
                    }
                }
            } else if (client.email) {
                const owner = await db.prepare("SELECT gst_username, gst_password, gst_share_status FROM users WHERE LOWER(email) = LOWER(?)").get(client.email);
                if (owner) {
                    gstShareStatus = owner.gst_share_status || 'Not Shared';
                    if (gstShareStatus === 'Shared') {
                        gstUsername = owner.gst_username;
                        encryptedPassword = owner.gst_password;
                    }
                }
            }

            if (gstShareStatus !== 'Shared') {
                return sendSuccess(res, { gstUsername: null, gstPassword: null, gstShareStatus }, 'GST credentials not shared');
            }

            const gstPassword = decrypt(encryptedPassword);

            const now = new Date().toISOString();
            const caUser = await db.prepare("SELECT username, email FROM users WHERE id = ?").get(req.user.id);
            const caName = caUser ? (caUser.username || caUser.email) : `CA #${req.user.id}`;
            const clientName = client.name || `Client #${clientId}`;
            const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

            await db.prepare(`
                INSERT INTO ca_gst_access_logs (ca_user_id, client_id, ca_name, client_name, accessed_at, ip_address, action)
                VALUES (?, ?, ?, ?, ?, ?, 'view')
            `).run(req.user.id, clientId, caName, clientName, now, ipAddress);

            return sendSuccess(res, { gstUsername, gstPassword, gstShareStatus }, 'GST credentials retrieved and action logged successfully');
        } catch (error) {
            console.error('[CA getClientGstCredentials Error]', error);
            return sendError(res, 'Failed to fetch GST credentials', 500);
        }
    },
    getOwnerGstCredentials: async (req, res) => {
        try {
            const user = await db.prepare("SELECT gst_username, gst_password, gst_share_status FROM users WHERE id = ?").get(req.user.id);
            if (!user) {
                return sendError(res, 'User not found', 404);
            }

            const gstUsername = user.gst_username || '';
            const decryptedPassword = decrypt(user.gst_password) || '';
            const gstShareStatus = user.gst_share_status || 'Not Shared';

            return sendSuccess(res, { gstUsername, gstPassword: decryptedPassword, gstShareStatus }, 'GST credentials retrieved successfully');
        } catch (error) {
            console.error('[Owner getOwnerGstCredentials Error]', error);
            return sendError(res, 'Failed to fetch owner GST credentials', 500);
        }
    },
    saveOwnerGstCredentials: async (req, res) => {
        const { gstUsername, gstPassword, share } = req.body;
        if (!gstUsername || !gstPassword) {
            return sendError(res, 'Username and password are required', 400);
        }
        try {
            const encryptedPassword = encrypt(gstPassword);
            const status = share ? 'Shared' : 'Not Shared';

            await db.prepare("UPDATE users SET gst_username = ?, gst_password = ?, gst_share_status = ? WHERE id = ?").run(gstUsername, encryptedPassword, status, req.user.id);
            await db.prepare("UPDATE ca_clients SET gst_share_status = ? WHERE business_owner_id = ?").run(status, req.user.id);

            return sendSuccess(res, { shared: share === true, gstShareStatus: status }, 'GST credentials saved and shared status updated successfully');
        } catch (error) {
            console.error('[Owner saveOwnerGstCredentials Error]', error);
            return sendError(res, 'Failed to save owner GST credentials', 500);
        }
    },
    revokeOwnerGstCredentials: async (req, res) => {
        try {
            await db.prepare("UPDATE users SET gst_username = NULL, gst_password = NULL, gst_share_status = 'Revoked' WHERE id = ?").run(req.user.id);
            await db.prepare("UPDATE ca_clients SET gst_share_status = 'Revoked' WHERE business_owner_id = ?").run(req.user.id);

            return sendSuccess(res, { revoked: true, gstShareStatus: 'Revoked' }, 'GST credentials sharing revoked successfully');
        } catch (error) {
            console.error('[Owner revokeOwnerGstCredentials Error]', error);
            return sendError(res, 'Failed to revoke owner GST credentials', 500);
        }
    },
    getClientGstStatus: async (req, res) => {
        const { id: clientId } = req.params;
        try {
            if (req.user.role !== 'ca') {
                return sendError(res, 'Access denied. Advisor role required.', 403);
            }
            const client = await db.prepare("SELECT * FROM ca_clients WHERE id = ? AND ca_user_id = ?").get(clientId, req.user.id);
            if (!client) {
                return sendError(res, 'Client not found or unauthorized', 404);
            }

            let gstShareStatus = client.gst_share_status || 'Not Shared';
            if (client.business_owner_id) {
                const owner = await db.prepare("SELECT gst_share_status FROM users WHERE id = ?").get(client.business_owner_id);
                if (owner) {
                    gstShareStatus = owner.gst_share_status || 'Not Shared';
                }
            } else if (client.email) {
                const owner = await db.prepare("SELECT gst_share_status FROM users WHERE LOWER(email) = LOWER(?)").get(client.email);
                if (owner) {
                    gstShareStatus = owner.gst_share_status || 'Not Shared';
                }
            }

            return sendSuccess(res, { gstShareStatus }, 'Client GST status retrieved successfully');
        } catch (error) {
            console.error('[CA getClientGstStatus Error]', error.message);
            return sendError(res, 'Failed to fetch GST status', 500);
        }
    },
    requestClientGstCredentials: async (req, res) => {
        const { id: clientId } = req.params;
        try {
            if (req.user.role !== 'ca') {
                return sendError(res, 'Access denied. Advisor role required.', 403);
            }
            const client = await db.prepare("SELECT * FROM ca_clients WHERE id = ? AND ca_user_id = ?").get(clientId, req.user.id);
            if (!client) {
                return sendError(res, 'Client not found or unauthorized', 404);
            }

            await db.prepare("UPDATE ca_clients SET gst_share_status = 'Requested' WHERE id = ?").run(clientId);

            if (client.business_owner_id) {
                await db.prepare("UPDATE users SET gst_share_status = 'Requested' WHERE id = ?").run(client.business_owner_id);
            } else if (client.email) {
                await db.prepare("UPDATE users SET gst_share_status = 'Requested' WHERE LOWER(email) = LOWER(?)").run(client.email);
            }

            return sendSuccess(res, { requested: true, gstShareStatus: 'Requested' }, 'GST Portal credentials requested successfully');
        } catch (error) {
            console.error('[CA requestClientGstCredentials Error]', error);
            return sendError(res, 'Failed to request GST credentials', 500);
        }
    },
    logGstClientAction: async (req, res) => {
        const { id: clientId } = req.params;
        const { action } = req.body;
        if (!action) {
            return sendError(res, 'Action is required', 400);
        }
        try {
            if (req.user.role !== 'ca') {
                return sendError(res, 'Access denied. Advisor role required.', 403);
            }
            const client = await db.prepare("SELECT * FROM ca_clients WHERE id = ? AND ca_user_id = ?").get(clientId, req.user.id);
            if (!client) {
                return sendError(res, 'Client not found or unauthorized', 404);
            }

            const now = new Date().toISOString();
            const caUser = await db.prepare("SELECT username, email FROM users WHERE id = ?").get(req.user.id);
            const caName = caUser ? (caUser.username || caUser.email) : `CA #${req.user.id}`;
            const clientName = client.name || `Client #${clientId}`;
            const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

            await db.prepare(`
                INSERT INTO ca_gst_access_logs (ca_user_id, client_id, ca_name, client_name, accessed_at, ip_address, action)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(req.user.id, clientId, caName, clientName, now, ipAddress, action);

            return sendSuccess(res, { logged: true, action }, 'Action logged successfully');
        } catch (error) {
            console.error('[CA logGstClientAction Error]', error);
            return sendError(res, 'Failed to log action', 500);
        }
    }
};

module.exports = caController;
