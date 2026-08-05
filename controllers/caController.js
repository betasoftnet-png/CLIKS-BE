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
        try { await db.prepare("ALTER TABLE users ADD COLUMN gst_shared_at TEXT").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE users ADD COLUMN gst_connected_advisor_id INTEGER").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE ca_tasks ADD COLUMN advisor_id INTEGER").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE ca_tasks ADD COLUMN advisor_email TEXT").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE ca_tasks ADD COLUMN client_email TEXT").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE ca_tasks ADD COLUMN task_description TEXT").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE ca_tasks ADD COLUMN created_at TEXT").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE ca_tasks ADD COLUMN phase TEXT").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE ca_document_versions ADD COLUMN phase TEXT").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE ca_client_requests ADD COLUMN phase TEXT").run(); } catch(e) {}

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

        await db.prepare(`
            CREATE TABLE IF NOT EXISTS ca_document_reviews (
                id ${idType},
                document_id TEXT NOT NULL,
                ca_user_id INTEGER NOT NULL,
                client_id INTEGER NOT NULL,
                status TEXT,
                remark TEXT,
                updated_at TEXT
            )
        `).run();

        await db.prepare(`
            CREATE TABLE IF NOT EXISTS ca_document_versions (
                id ${idType},
                document_id TEXT NOT NULL,
                version_number INTEGER NOT NULL,
                file_name TEXT NOT NULL,
                file_path TEXT NOT NULL,
                uploaded_by INTEGER NOT NULL,
                uploaded_at TEXT NOT NULL
            )
        `).run();

        await db.prepare(`
            CREATE TABLE IF NOT EXISTS ca_tds_history (
                id ${idType},
                ca_user_id INTEGER NOT NULL,
                client_id INTEGER,
                client_name TEXT,
                financial_year TEXT,
                section TEXT,
                amount REAL,
                calculated_tds REAL,
                payment_date TEXT,
                residential_status TEXT,
                recipient_category TEXT,
                pan_not_available INTEGER DEFAULT 0,
                surcharge_rate TEXT,
                created_by TEXT,
                created_at TEXT
            )
        `).run();

        await db.prepare(`
            CREATE TABLE IF NOT EXISTS user_presence (
                id ${idType},
                user_id INTEGER UNIQUE NOT NULL,
                user_type TEXT,
                login_time TEXT,
                last_activity TEXT,
                logout_time TEXT,
                status TEXT DEFAULT 'Offline',
                socket_id TEXT
            )
        `).run();
        try { await db.prepare("ALTER TABLE user_presence ADD COLUMN socket_id TEXT").run(); } catch(e) {}

        await db.prepare(`
            CREATE TABLE IF NOT EXISTS gst_credentials (
                id ${idType},
                business_owner_id INTEGER NOT NULL,
                connected_ca_id INTEGER,
                gst_username TEXT,
                encrypted_password TEXT,
                shared_status TEXT DEFAULT 'Not Shared',
                shared_date TEXT,
                revoked_date TEXT,
                created_at TEXT,
                updated_at TEXT
            )
        `).run();

        await db.prepare(`
            CREATE TABLE IF NOT EXISTS notifications (
                id ${idType},
                sender_id INTEGER,
                receiver_id INTEGER,
                user_id INTEGER,
                type TEXT DEFAULT 'Info',
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                related_task_id INTEGER,
                is_read INTEGER DEFAULT 0,
                link TEXT,
                created_at TEXT
            )
        `).run();

        await db.prepare(`
            CREATE TABLE IF NOT EXISTS ca_audit_sessions (
                id ${idType},
                session_id TEXT UNIQUE,
                ca_user_id INTEGER NOT NULL,
                client_id INTEGER,
                business_owner_id INTEGER,
                start_time TEXT,
                stop_time TEXT,
                duration_seconds INTEGER,
                audit_date TEXT,
                status TEXT DEFAULT 'Completed',
                created_at TEXT
            )
        `).run();

        await db.prepare(`
            CREATE TABLE IF NOT EXISTS ca_professional_services (
                id ${idType},
                ca_user_id INTEGER NOT NULL,
                client_id INTEGER,
                business_owner_id INTEGER,
                audit_session_id INTEGER,
                audit_description TEXT,
                duration_seconds INTEGER,
                duration_text TEXT,
                hourly_rate REAL DEFAULT 500,
                professional_fee REAL DEFAULT 0,
                gst_amount REAL DEFAULT 0,
                grand_total REAL DEFAULT 0,
                status TEXT DEFAULT 'Pending',
                created_at TEXT
            )
        `).run();

        await db.prepare(`
            CREATE TABLE IF NOT EXISTS ca_professional_invoices (
                id ${idType},
                invoice_number TEXT UNIQUE NOT NULL,
                ca_user_id INTEGER NOT NULL,
                business_owner_id INTEGER NOT NULL,
                client_id INTEGER,
                audit_session_id INTEGER,
                amount REAL DEFAULT 0,
                gst_amount REAL DEFAULT 0,
                total_amount REAL DEFAULT 0,
                status TEXT DEFAULT 'Unpaid',
                invoice_date TEXT,
                pdf_path TEXT,
                created_at TEXT
            )
        `).run();

        await db.prepare(`
            CREATE TABLE IF NOT EXISTS invoice_items (
                id ${idType},
                invoice_id INTEGER NOT NULL,
                description TEXT,
                quantity INTEGER DEFAULT 1,
                rate REAL DEFAULT 0,
                amount REAL DEFAULT 0
            )
        `).run();

        await db.prepare(`
            CREATE TABLE IF NOT EXISTS ca_payments (
                id ${idType},
                payment_id TEXT UNIQUE,
                invoice_id INTEGER NOT NULL,
                ca_user_id INTEGER,
                user_id INTEGER NOT NULL,
                amount REAL DEFAULT 0,
                payment_method TEXT,
                transaction_id TEXT UNIQUE,
                status TEXT DEFAULT 'Success',
                paid_at TEXT,
                created_at TEXT
            )
        `).run();

        try { await db.prepare("ALTER TABLE notifications ADD COLUMN sender_id INTEGER").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE notifications ADD COLUMN receiver_id INTEGER").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE notifications ADD COLUMN related_task_id INTEGER").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE ca_tasks ADD COLUMN updated_at TEXT").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE ca_payments ADD COLUMN payment_id TEXT").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE ca_payments ADD COLUMN ca_user_id INTEGER").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE ca_payments ADD COLUMN created_at TEXT").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE ca_audit_sessions ADD COLUMN session_id TEXT").run(); } catch(e) {}
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
            // Requirement: Cleanup offline users before returning status
            const timeout = new Date(Date.now() - 90 * 1000).toISOString();
            await db.prepare('UPDATE users SET is_online = 0 WHERE is_online = 1 AND last_seen_at < ?').run(timeout);

            const list = await db.prepare(`
                SELECT i.*, u.is_online, u.last_seen_at, u.login_at, u.username as receiver_name
                FROM ca_invitations i
                LEFT JOIN users u ON LOWER(i.receiver_email) = LOWER(u.email)
                WHERE i.sender_id = ?
                ORDER BY i.id DESC
            `).all(req.user.id);
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
                SELECT i.*, u.is_online, u.last_seen_at, u.login_at, u.username as sender_name_full
                FROM ca_invitations i
                LEFT JOIN users u ON LOWER(i.sender_email) = LOWER(u.email)
                WHERE LOWER(i.receiver_email) = LOWER(?) OR i.receiver_id = ?
                ORDER BY i.id DESC
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
                business_owner_id: item.business_owner_id,
                ca_user_id: item.ca_user_id,
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
            const docId = `request_${id}`;
            const now = new Date().toISOString();

            await db.prepare(`
                UPDATE ca_client_requests 
                SET status = 'Under Review', attached_file = ? 
                WHERE id = ?
            `).run(attachedFile, id);

            // Record version
            const latestVersion = await db.prepare("SELECT MAX(version_number) as v FROM ca_document_versions WHERE document_id = ?").get(docId);
            const nextVersion = (latestVersion?.v || 0) + 1;

            await db.prepare(`
                INSERT INTO ca_document_versions (document_id, version_number, file_name, file_path, uploaded_by, uploaded_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(docId, nextVersion, attachedFile, `/uploads/${attachedFile}`, req.user.id, now);

            // Reset review status if it was previously corrected
            await db.prepare("DELETE FROM ca_document_reviews WHERE document_id = ?").run(docId);

            if (requestRecord.ca_user_id) {
                const senderName = requestRecord.client_name || 'Client';
                const messageText = `Client ${senderName} has uploaded ${nextVersion > 1 ? 'a revised' : 'a'} document for request: "${requestRecord.title}".`;
                await db.prepare(`
                    INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
                    VALUES (?, ?, ?, 'Info', 0, ?)
                `).run(requestRecord.ca_user_id, 'Document Uploaded', messageText, now);
            }

            return sendSuccess(res, { id: parseInt(id), status: 'Under Review', attachedFile, version: nextVersion }, 'Document uploaded successfully');
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

            // Query tasks where:
            // 1. Logged-in user is the creator (CA)
            // 2. Logged-in user is the assigned Business Owner (by business_owner_id or client_id)
            // 3. Logged-in user is the client by email or name match
            const list = await db.prepare(`
                SELECT * FROM ca_tasks 
                WHERE ca_user_id = ? 
                   OR business_owner_id = ?
                   OR client_id = ?
                   OR LOWER(client_email) = LOWER(?)
                   OR LOWER(client_name) = LOWER(?)
                ORDER BY id DESC
            `).all(req.user.id, req.user.id, req.user.id, email, email);

            const mapped = list.map(item => ({
                id: item.id,
                taskId: item.id,
                ca_user_id: item.ca_user_id,
                advisorId: item.ca_user_id || item.advisor_id,
                advisorEmail: item.advisor_email,
                businessOwnerId: item.business_owner_id,
                clientId: item.business_owner_id || item.client_id,
                client_id: item.client_id,
                clientEmail: item.client_email,
                clientName: item.client_name,
                title: item.title,
                taskDescription: item.task_description || item.title,
                status: item.status,
                priority: item.priority,
                dueDate: item.due_date,
                askForDocument: item.ask_for_document == 1 || item.ask_for_document === 'true' || item.ask_for_document === true,
                attachedFile: item.attached_file,
                createdAt: item.created_at
            }));
            return sendSuccess(res, mapped, 'Practice tasks retrieved');
        } catch (error) {
            console.error('[CA getTasks Error]', error);
            return sendError(res, 'Failed to fetch practice tasks', 500);
        }
    },
    addTask: async (req, res) => {
        const { clientName, businessOwnerEmail, title, priority, dueDate, askForDocument } = req.body;
        if (!title) return sendError(res, 'Task title is required', 400);
        try {
            const defaultDate = dueDate || new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString().split('T')[0];
            const askDocInt = (askForDocument === 'true' || askForDocument === true || askForDocument == 1) ? 1 : 0;

            let businessOwnerId = null;
            let clientId = null;
            let clientEmail = businessOwnerEmail ? businessOwnerEmail.toLowerCase() : null;

            // 1. Try to find user by provided businessOwnerEmail
            if (clientEmail) {
                const owner = await db.prepare("SELECT id FROM users WHERE LOWER(email) = ?").get(clientEmail);
                if (owner) {
                    businessOwnerId = owner.id;
                }
            }

            // 2. Fallback to clientName logic if email not found or not provided
            if (!businessOwnerId) {
                const client = await db.prepare(`
                    SELECT * FROM ca_clients
                    WHERE ca_user_id = ? AND (LOWER(name) = LOWER(?) OR LOWER(email) = LOWER(?))
                `).get(req.user.id, clientName, clientName);

                if (client) {
                    clientId = client.id;
                    businessOwnerId = client.business_owner_id;
                    if (!clientEmail) clientEmail = client.email ? client.email.toLowerCase() : null;
                    if (!businessOwnerId && client.email) {
                        const owner = await db.prepare("SELECT id FROM users WHERE LOWER(email) = LOWER(?)").get(client.email);
                        if (owner) {
                            businessOwnerId = owner.id;
                        }
                    }
                } else {
                    const owner = await db.prepare("SELECT id, email FROM users WHERE LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?)").get(clientName, clientName);
                    if (owner) {
                        businessOwnerId = owner.id;
                        if (!clientEmail) clientEmail = owner.email ? owner.email.toLowerCase() : null;
                    }
                }
            }

            // Fallback for advisor details
            const advisor = await db.prepare("SELECT email FROM users WHERE id = ?").get(req.user.id);
            const advisorEmail = req.user.email || (advisor ? advisor.email : '');
            const now = new Date().toISOString();

            // Requirement 8: Do not create duplicate tasks
            const duplicate = await db.prepare(`
                SELECT id FROM ca_tasks 
                WHERE ca_user_id = ? AND LOWER(client_name) = LOWER(?) AND title = ? AND due_date = ?
            `).get(req.user.id, clientName || 'General Client', title.trim(), defaultDate);

            if (duplicate) {
                const existingTask = await db.prepare("SELECT * FROM ca_tasks WHERE id = ?").get(duplicate.id);
                return sendSuccess(res, {
                    id: existingTask.id,
                    taskId: existingTask.id,
                    clientName: existingTask.client_name,
                    title: existingTask.title,
                    taskDescription: existingTask.task_description || existingTask.title,
                    status: existingTask.status,
                    priority: existingTask.priority,
                    dueDate: existingTask.due_date,
                    askForDocument: existingTask.ask_for_document == 1 || existingTask.ask_for_document === 'true',
                    attachedFile: existingTask.attached_file,
                    businessOwnerId: existingTask.business_owner_id,
                    clientId: existingTask.business_owner_id || existingTask.client_id,
                    advisorId: existingTask.ca_user_id,
                    advisorEmail: existingTask.advisor_email,
                    clientEmail: existingTask.client_email,
                    createdAt: existingTask.created_at
                }, 'Task already exists');
            }

            const result = await db.prepare(`
                INSERT INTO ca_tasks (
                    ca_user_id, advisor_id, advisor_email, client_name, client_email, 
                    title, task_description, status, priority, due_date, 
                    ask_for_document, attached_file, business_owner_id, client_id, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?, ?, null, ?, ?, ?)
            `).run(
                req.user.id, req.user.id, advisorEmail, clientName || 'General Client', clientEmail, 
                title.trim(), title.trim(), priority || 'Medium', defaultDate, 
                askDocInt, businessOwnerId, clientId, now
            );

            const taskId = result.lastInsertRowid;

            // Notify Business Owner if they exist
            if (businessOwnerId) {
                const messageText = `Your FIN-PRO Advisor has assigned a new compliance task: "${title}". Deadline: ${defaultDate}. Priority: ${priority || 'Medium'}.`;
                await db.prepare(`
                    INSERT INTO notifications (sender_id, receiver_id, user_id, title, message, type, related_task_id, is_read, created_at)
                    VALUES (?, ?, ?, 'New Task Assigned', ?, 'New Task Assigned', ?, 0, ?)
                `).run(req.user.id, businessOwnerId, businessOwnerId, messageText, taskId, now);
            }

            const newTask = {
                id: taskId,
                taskId,
                clientName: clientName || 'General Client',
                clientEmail,
                title,
                taskDescription: title,
                status: 'Pending',
                priority: priority || 'Medium',
                dueDate: defaultDate,
                askForDocument: !!askForDocument,
                attachedFile: null,
                businessOwnerId,
                clientId: businessOwnerId || clientId,
                advisorId: req.user.id,
                advisorEmail,
                createdAt: now
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

            const task = await db.prepare(`
                SELECT * FROM ca_tasks 
                WHERE id = ? AND (
                    ca_user_id = ? 
                    OR business_owner_id = ? 
                    OR client_id = ?
                    OR LOWER(client_email) = LOWER(?)
                    OR LOWER(client_name) = LOWER(?)
                )
            `).get(id, req.user.id, req.user.id, req.user.id, email, email);

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
            } else if (task.status === 'Approved') {
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
        const { phase } = req.body;
        try {
            const attachedFile = `uploaded_task_doc_${Date.now().toString().slice(-4)}.pdf`;
            const docId = `task_${id}`;
            const now = new Date().toISOString();

            await db.prepare(`
                UPDATE ca_tasks 
                SET attached_file = ?, status = 'Uploaded', phase = ?
                WHERE id = ?
            `).run(attachedFile, phase || null, id);

            // Fetch the updated task to notify the CA
            const task = await db.prepare("SELECT * FROM ca_tasks WHERE id = ?").get(id);

            // Record version
            const latestVersion = await db.prepare("SELECT MAX(version_number) as v FROM ca_document_versions WHERE document_id = ?").get(docId);
            const nextVersion = (latestVersion?.v || 0) + 1;

            await db.prepare(`
                INSERT INTO ca_document_versions (document_id, version_number, file_name, file_path, uploaded_by, uploaded_at, phase)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(docId, nextVersion, attachedFile, `/uploads/${attachedFile}`, req.user.id, now, phase || null);

            // Reset review status if it was previously corrected
            await db.prepare("DELETE FROM ca_document_reviews WHERE document_id = ?").run(docId);

            if (task) {
                const targetUserId = task.ca_user_id === req.user.id ? task.business_owner_id : task.ca_user_id;
                if (targetUserId) {
                    const senderName = req.user.username || task.client_name || 'User';
                    const messageText = `${senderName} has uploaded ${nextVersion > 1 ? 'a revised' : 'a'} document for compliance task: "${task.title}".`;
                    await db.prepare(`
                        INSERT INTO notifications (sender_id, receiver_id, user_id, title, message, type, related_task_id, is_read, created_at)
                        VALUES (?, ?, ?, 'Document Uploaded', ?, 'Document Uploaded', ?, 0, ?)
                    `).run(req.user.id, targetUserId, targetUserId, messageText, id, now);
                }
            }

            return sendSuccess(res, { id: parseInt(id), status: 'Uploaded', attachedFile, version: nextVersion, phase: phase || null }, 'Task document uploaded successfully');
        } catch (error) {
            console.error('[CA uploadTaskDoc Error]', error);
            return sendError(res, 'Failed to upload task document', 500);
        }
    },

    uploadClientPhaseDoc: async (req, res) => {
        const { id: clientId } = req.params;
        const { phase } = req.body;
        if (!phase) return sendError(res, 'Phase is required', 400);

        try {
            const client = await db.prepare("SELECT * FROM ca_clients WHERE id = ?").get(clientId);
            if (!client) return sendError(res, 'Client not found', 404);

            const title = `${phase} Document Repository`;

            // Find or create the phase task
            let task = await db.prepare("SELECT * FROM ca_tasks WHERE ca_user_id = ? AND client_id = ? AND title = ? AND phase = ?").get(req.user.id, clientId, title, phase);

            if (!task) {
                const now = new Date().toISOString();
                const result = await db.prepare(`
                    INSERT INTO ca_tasks (ca_user_id, client_id, business_owner_id, client_name, title, status, priority, due_date, phase, created_at)
                    VALUES (?, ?, ?, ?, ?, 'Uploaded', 'Medium', ?, ?, ?)
                `).run(req.user.id, clientId, client.business_owner_id, client.name, title, now.split('T')[0], phase, now);
                task = { id: result.lastInsertRowid, title };
            }

            // Use provided filename if available, otherwise generate one
            const { fileName } = req.body;
            const attachedFile = fileName || `uploaded_phase_doc_${Date.now().toString().slice(-4)}.pdf`;
            const docId = `task_${task.id}`;
            const now = new Date().toISOString();

            await db.prepare(`
                UPDATE ca_tasks
                SET attached_file = ?, status = 'Uploaded'
                WHERE id = ?
            `).run(attachedFile, task.id);

            const latestVersion = await db.prepare("SELECT MAX(version_number) as v FROM ca_document_versions WHERE document_id = ?").get(docId);
            const nextVersion = (latestVersion?.v || 0) + 1;

            await db.prepare(`
                INSERT INTO ca_document_versions (document_id, version_number, file_name, file_path, uploaded_by, uploaded_at, phase)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(docId, nextVersion, attachedFile, `/uploads/${attachedFile}`, req.user.id, now, phase);

            return sendSuccess(res, { taskId: task.id, attachedFile, version: nextVersion, phase }, 'Phase document uploaded successfully');
        } catch (error) {
            console.error('[CA uploadClientPhaseDoc Error]', error);
            return sendError(res, 'Failed to upload phase document', 500);
        }
    },

    getPhaseDocument: async (req, res) => {
        const { id } = req.params;
        const phase = req.query.phase || 'Phase 1';
        try {
            const client = await db.prepare("SELECT * FROM ca_clients WHERE id = ? AND ca_user_id = ?").get(id, req.user.id);
            if (!client) {
                return sendError(res, 'Client not found', 404);
            }

            const ownerUser = await db.prepare("SELECT * FROM users WHERE id = ? OR LOWER(email) = LOWER(?)").get(client.business_owner_id || -1, client.email || '');
            const businessOwnerName = ownerUser?.username || client.name || 'Business Owner';

            // 1. Search in ca_tasks for phase document attached
            const taskDoc = await db.prepare(`
                SELECT * FROM ca_tasks 
                WHERE ca_user_id = ? 
                  AND (client_id = ? OR business_owner_id = ? OR LOWER(client_name) = LOWER(?) OR LOWER(client_name) = LOWER(?))
                  AND phase = ?
                  AND attached_file IS NOT NULL
                ORDER BY id DESC
            `).get(req.user.id, client.id, client.business_owner_id || -1, client.name, client.email || '', phase);

            // 2. Search in ca_document_versions for latest phase upload by business owner
            const versionDoc = await db.prepare(`
                SELECT v.*, u.username as uploader_name
                FROM ca_document_versions v
                LEFT JOIN users u ON v.uploaded_by = u.id
                WHERE v.phase = ?
                ORDER BY v.id DESC
            `).get(phase);

            // 3. Search in ca_client_requests
            const reqDoc = await db.prepare(`
                SELECT * FROM ca_client_requests
                WHERE ca_user_id = ?
                  AND (LOWER(client_name) = LOWER(?) OR LOWER(client_name) = LOWER(?))
                  AND phase = ?
                  AND attached_file IS NOT NULL
                ORDER BY id DESC
            `).get(req.user.id, client.name, client.email || '', phase);

            let selectedDoc = null;
            if (taskDoc) {
                const docId = `task_${taskDoc.id}`;
                const verInfo = await db.prepare("SELECT v.*, u.username as uploader_name FROM ca_document_versions v LEFT JOIN users u ON v.uploaded_by = u.id WHERE v.document_id = ? ORDER BY v.version_number DESC").get(docId);
                selectedDoc = {
                    fileName: taskDoc.attached_file,
                    filePath: `/uploads/${taskDoc.attached_file}`,
                    uploadedBy: verInfo?.uploader_name || businessOwnerName,
                    uploadedAt: verInfo?.uploaded_at || taskDoc.updated_at || taskDoc.created_at || taskDoc.due_date || new Date().toISOString(),
                    phase: phase
                };
            } else if (reqDoc) {
                selectedDoc = {
                    fileName: reqDoc.attached_file,
                    filePath: `/uploads/${reqDoc.attached_file}`,
                    uploadedBy: businessOwnerName,
                    uploadedAt: reqDoc.updated_at || reqDoc.created_at || new Date().toISOString(),
                    phase: phase
                };
            } else if (versionDoc) {
                selectedDoc = {
                    fileName: versionDoc.file_name,
                    filePath: versionDoc.file_path.startsWith('/') ? versionDoc.file_path : `/uploads/${versionDoc.file_name}`,
                    uploadedBy: versionDoc.uploader_name || businessOwnerName,
                    uploadedAt: versionDoc.uploaded_at,
                    phase: phase
                };
            }

            if (!selectedDoc) {
                return sendSuccess(res, null, 'No document uploaded by the Business Owner for this phase.');
            }

            // Determine file size and file type
            const pathModule = require('path');
            const fsModule = require('fs');
            const diskPath = pathModule.join(__dirname, '../uploads', selectedDoc.fileName);
            let fileSizeStr = '1.2 MB';
            try {
                if (fsModule.existsSync(diskPath)) {
                    const stats = fsModule.statSync(diskPath);
                    const bytes = stats.size;
                    if (bytes < 1024) fileSizeStr = `${bytes} B`;
                    else if (bytes < 1024 * 1024) fileSizeStr = `${(bytes / 1024).toFixed(1)} KB`;
                    else fileSizeStr = `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
                }
            } catch (e) {}

            const fileExt = (selectedDoc.fileName || '').split('.').pop().toUpperCase() || 'PDF';

            return sendSuccess(res, {
                fileName: selectedDoc.fileName,
                filePath: selectedDoc.filePath,
                uploadedBy: selectedDoc.uploadedBy,
                uploadedAt: selectedDoc.uploadedAt,
                fileSize: fileSizeStr,
                phase: selectedDoc.phase,
                fileType: fileExt
            }, 'Phase document retrieved successfully');
        } catch (error) {
            console.error('[CA getPhaseDocument Error]', error);
            return sendError(res, 'Failed to retrieve phase document', 500);
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
                    task_name: `Client Request: ${reqRec.title}`,
                    phase: reqRec.phase || null
                });
            });

            // 4. Fetch Client Tasks with attached files
            const clientTasks = await db.prepare(`
                SELECT * FROM ca_tasks 
                WHERE ca_user_id = ? 
                  AND (client_id = ? OR business_owner_id = ? OR LOWER(client_name) = LOWER(?) OR LOWER(client_name) = LOWER(?))
                  AND attached_file IS NOT NULL
            `).all(req.user.id, client.id, client.business_owner_id, client.name, client.email || '');
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
                    task_name: `Assigned Task: ${taskRec.title}`,
                    phase: taskRec.phase
                });
            });

            // 5. Fetch Reviews & Remarks
            const reviews = await db.prepare("SELECT * FROM ca_document_reviews WHERE ca_user_id = ? AND client_id = ?").all(req.user.id, client.id);
            const reviewsMap = {};
            reviews.forEach(r => {
                reviewsMap[r.document_id] = { status: r.status, remark: r.remark };
            });

            // 6. Fetch latest version info including uploader and actual timestamp
            const versions = await db.prepare(`
                SELECT v1.document_id, v1.version_number, v1.uploaded_at, v1.phase, u.username as uploader_name
                FROM ca_document_versions v1
                JOIN (
                    SELECT document_id, MAX(version_number) as max_v
                    FROM ca_document_versions
                    GROUP BY document_id
                ) v2 ON v1.document_id = v2.document_id AND v1.version_number = v2.max_v
                LEFT JOIN users u ON v1.uploaded_by = u.id
            `).all();
            const versionsMap = {};
            versions.forEach(v => {
                versionsMap[v.document_id] = {
                    version: v.version_number,
                    uploaded_at: v.uploaded_at,
                    uploader_name: v.uploader_name,
                    phase: v.phase
                };
            });

            // Map all documents with review statuses
            const mappedDocs = allDocs.map(doc => {
                const rev = reviewsMap[doc.id] || {};
                const verInfo = versionsMap[doc.id] || { version: 1 };
                let defaultStatus = 'Uploaded';
                if (doc.source_table === 'ca_tasks') {
                    const taskRec = clientTasks.find(t => t.id === doc.source_id);
                    if (taskRec && taskRec.status) {
                        defaultStatus = taskRec.status;
                    }
                } else if (doc.source_table === 'ca_client_requests') {
                    const reqRec = clientRequests.find(r => r.id === doc.source_id);
                    if (reqRec && reqRec.status) {
                        defaultStatus = reqRec.status;
                    }
                }

                // Professional touch: if status is 'Uploaded', display as 'Pending Review' in Workpaper
                let displayStatus = rev.status || defaultStatus;
                if (displayStatus === 'Uploaded') displayStatus = 'Pending Review';

                return {
                    ...doc,
                    status: displayStatus,
                    remark: rev.remark || '',
                    version: verInfo.version,
                    uploaded_at: verInfo.uploaded_at || doc.uploaded_at,
                    uploaded_by: verInfo.uploader_name || doc.uploaded_by,
                    phase: verInfo.phase || doc.phase || null
                };
            });

            return sendSuccess(res, mappedDocs, 'Client documents retrieved successfully');
        } catch (error) {
            console.error('[CA getClientDocuments Error]', error);
            return sendError(res, 'Failed to retrieve client documents', 500);
        }
    },
    getDocumentVersions: async (req, res) => {
        const { docId } = req.params;
        try {
            const versions = await db.prepare("SELECT * FROM ca_document_versions WHERE document_id = ? ORDER BY version_number DESC").all(docId);
            return sendSuccess(res, versions, 'Document versions retrieved');
        } catch (error) {
            console.error('[CA getDocumentVersions Error]', error);
            return sendError(res, 'Failed to retrieve document versions', 500);
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
            
            // Explicitly support transitions (no more hard mapping to Verified)
            const finalStatusVal = status;

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
            if (finalStatusVal === 'Under Review' || finalStatusVal === 'Verified' || finalStatusVal === 'Approved' || finalStatusVal === 'Needs Correction') {
                if (documentId.startsWith('task_')) {
                    const taskId = documentId.split('_')[1];
                    // Requirement: Mark task as Completed when Approved
                    const syncStatus = finalStatusVal === 'Approved' ? 'Completed' : finalStatusVal;
                    await db.prepare("UPDATE ca_tasks SET status = ? WHERE id = ?").run(syncStatus, taskId);
                } else if (documentId.startsWith('request_')) {
                    const requestId = documentId.split('_')[1];
                    await db.prepare("UPDATE ca_client_requests SET status = ? WHERE id = ?").run(finalStatusVal, requestId);
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

            // Notify Business Owner
            let businessOwnerId = null;
            let docName = 'Document';
            if (documentId.startsWith('task_')) {
                const t = await db.prepare("SELECT business_owner_id, title FROM ca_tasks WHERE id = ?").get(documentId.split('_')[1]);
                businessOwnerId = t?.business_owner_id;
                docName = t?.title || 'Document';
            } else if (documentId.startsWith('request_')) {
                const c = await db.prepare("SELECT business_owner_id FROM ca_clients WHERE id = ?").get(clientId);
                const r = await db.prepare("SELECT title FROM ca_client_requests WHERE id = ?").get(documentId.split('_')[1]);
                businessOwnerId = c?.business_owner_id;
                docName = r?.title || 'Document';
            }

            if (businessOwnerId && status) {
                const message = `Your auditor has updated the review for "${docName}". Status: ${status}. ${remark ? 'Note: ' + remark : ''}`;
                await db.prepare(`
                    INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
                    VALUES (?, ?, ?, 'Info', 0, ?)
                `).run(businessOwnerId, 'Document Review Updated', message, now);
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
            // Authorization: verify the logged-in user owns this ca_clients record
            const client = await db.prepare("SELECT * FROM ca_clients WHERE id = ? AND ca_user_id = ?").get(clientId, req.user.id);
            if (!client) {
                return sendError(res, 'Client not found or unauthorized', 404);
            }

            let gstShareStatus = client.gst_share_status || 'Not Shared';
            let gstUsername = null;
            let encryptedPassword = null;

            if (client.business_owner_id) {
                const owner = await db.prepare("SELECT gst_username, gst_password, gst_share_status, gst_connected_advisor_id FROM users WHERE id = ?").get(client.business_owner_id);
                if (owner) {
                    gstShareStatus = owner.gst_share_status || 'Not Shared';
                    // Verify the credentials are shared with THIS specific CA
                    if (gstShareStatus === 'Shared' && (!owner.gst_connected_advisor_id || owner.gst_connected_advisor_id === req.user.id)) {
                        gstUsername = owner.gst_username;
                        encryptedPassword = owner.gst_password;
                    } else if (gstShareStatus === 'Shared' && owner.gst_connected_advisor_id && owner.gst_connected_advisor_id !== req.user.id) {
                        // Credentials shared with a different CA
                        return sendSuccess(res, { gstUsername: null, gstPassword: null, gstShareStatus: 'Not Shared' }, 'GST credentials not shared with this advisor');
                    }
                }
            } else if (client.email) {
                const owner = await db.prepare("SELECT gst_username, gst_password, gst_share_status, gst_connected_advisor_id FROM users WHERE LOWER(email) = LOWER(?)").get(client.email);
                if (owner) {
                    gstShareStatus = owner.gst_share_status || 'Not Shared';
                    if (gstShareStatus === 'Shared' && (!owner.gst_connected_advisor_id || owner.gst_connected_advisor_id === req.user.id)) {
                        gstUsername = owner.gst_username;
                        encryptedPassword = owner.gst_password;
                    } else if (gstShareStatus === 'Shared' && owner.gst_connected_advisor_id && owner.gst_connected_advisor_id !== req.user.id) {
                        return sendSuccess(res, { gstUsername: null, gstPassword: null, gstShareStatus: 'Not Shared' }, 'GST credentials not shared with this advisor');
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
            const sharedAt = share ? new Date().toISOString() : null;

            // Look up the connected CA from accepted invitations
            let connectedAdvisorId = null;
            if (share) {
                const acceptedInvite = await db.prepare(`
                    SELECT receiver_id FROM ca_invitations 
                    WHERE sender_id = ? AND status = 'Accepted' 
                    ORDER BY updated_at DESC LIMIT 1
                `).get(req.user.id);
                if (acceptedInvite && acceptedInvite.receiver_id) {
                    connectedAdvisorId = acceptedInvite.receiver_id;
                }
            }

            await db.prepare(
                "UPDATE users SET gst_username = ?, gst_password = ?, gst_share_status = ?, gst_shared_at = ?, gst_connected_advisor_id = ? WHERE id = ?"
            ).run(gstUsername, encryptedPassword, status, sharedAt, connectedAdvisorId, req.user.id);

            // Update ca_clients for the connected CA specifically
            if (connectedAdvisorId) {
                await db.prepare("UPDATE ca_clients SET gst_share_status = ? WHERE business_owner_id = ? AND ca_user_id = ?").run(status, req.user.id, connectedAdvisorId);
            } else {
                // Fallback: update all ca_clients records for this business owner
                await db.prepare("UPDATE ca_clients SET gst_share_status = ? WHERE business_owner_id = ?").run(status, req.user.id);
            }

            return sendSuccess(res, { shared: share === true, gstShareStatus: status, connectedAdvisorId, sharedAt }, 'GST credentials saved and shared status updated successfully');
        } catch (error) {
            console.error('[Owner saveOwnerGstCredentials Error]', error);
            return sendError(res, 'Failed to save owner GST credentials', 500);
        }
    },
    revokeOwnerGstCredentials: async (req, res) => {
        try {
            await db.prepare("UPDATE users SET gst_username = NULL, gst_password = NULL, gst_share_status = 'Revoked', gst_shared_at = NULL, gst_connected_advisor_id = NULL WHERE id = ?").run(req.user.id);
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
            // Authorization: verify the logged-in user owns this ca_clients record
            const client = await db.prepare("SELECT * FROM ca_clients WHERE id = ? AND ca_user_id = ?").get(clientId, req.user.id);
            if (!client) {
                return sendError(res, 'Client not found or unauthorized', 404);
            }

            let gstShareStatus = client.gst_share_status || 'Not Shared';
            if (client.business_owner_id) {
                const owner = await db.prepare("SELECT gst_share_status, gst_connected_advisor_id FROM users WHERE id = ?").get(client.business_owner_id);
                if (owner) {
                    // Only show 'Shared' if credentials are shared with THIS CA
                    if (owner.gst_share_status === 'Shared' && owner.gst_connected_advisor_id && owner.gst_connected_advisor_id !== req.user.id) {
                        gstShareStatus = 'Not Shared';
                    } else {
                        gstShareStatus = owner.gst_share_status || 'Not Shared';
                    }
                }
            } else if (client.email) {
                const owner = await db.prepare("SELECT gst_share_status, gst_connected_advisor_id FROM users WHERE LOWER(email) = LOWER(?)").get(client.email);
                if (owner) {
                    if (owner.gst_share_status === 'Shared' && owner.gst_connected_advisor_id && owner.gst_connected_advisor_id !== req.user.id) {
                        gstShareStatus = 'Not Shared';
                    } else {
                        gstShareStatus = owner.gst_share_status || 'Not Shared';
                    }
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
            // Authorization: verify the logged-in user owns this ca_clients record
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
            // Authorization: verify the logged-in user owns this ca_clients record
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
    },
    getTdsHistory: async (req, res) => {
        try {
            const history = await db.prepare("SELECT * FROM ca_tds_history WHERE ca_user_id = ? ORDER BY created_at DESC").all(req.user.id);
            return sendSuccess(res, history, 'TDS history retrieved');
        } catch (error) {
            console.error('[CA getTdsHistory Error]', error);
            return sendError(res, 'Failed to retrieve TDS history', 500);
        }
    },
    saveTdsCalculation: async (req, res) => {
        const { client_id, client_name, financial_year, section, amount, calculated_tds, payment_date, residential_status, recipient_category, pan_not_available, surcharge_rate } = req.body;
        try {
            const now = new Date().toISOString();
            const caUser = await db.prepare("SELECT username, email FROM users WHERE id = ?").get(req.user.id);
            const createdBy = caUser ? (caUser.username || caUser.email) : `CA #${req.user.id}`;

            const result = await db.prepare(`
                INSERT INTO ca_tds_history (
                    ca_user_id, client_id, client_name, financial_year, section, amount, calculated_tds,
                    payment_date, residential_status, recipient_category, pan_not_available, surcharge_rate, created_by, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                req.user.id, client_id || null, client_name, financial_year, section, amount, calculated_tds,
                payment_date, residential_status, recipient_category, pan_not_available ? 1 : 0, surcharge_rate, createdBy, now
            );
            return sendSuccess(res, { id: result.lastInsertRowid }, 'TDS calculation saved to history');
        } catch (error) {
            console.error('[CA saveTdsCalculation Error]', error);
            return sendError(res, 'Failed to save TDS calculation', 500);
        }
    },
    updateTdsCalculation: async (req, res) => {
        const { id } = req.params;
        const { financial_year, section, amount, calculated_tds, payment_date, residential_status, recipient_category, pan_not_available, surcharge_rate } = req.body;
        try {
            await db.prepare(`
                UPDATE ca_tds_history SET
                    financial_year = ?, section = ?, amount = ?, calculated_tds = ?,
                    payment_date = ?, residential_status = ?, recipient_category = ?,
                    pan_not_available = ?, surcharge_rate = ?
                WHERE id = ? AND ca_user_id = ?
            `).run(
                financial_year, section, amount, calculated_tds,
                payment_date, residential_status, recipient_category,
                pan_not_available ? 1 : 0, surcharge_rate, id, req.user.id
            );
            return sendSuccess(res, null, 'TDS calculation updated');
        } catch (error) {
            console.error('[CA updateTdsCalculation Error]', error);
            return sendError(res, 'Failed to update TDS calculation', 500);
        }
    },
    deleteTdsCalculation: async (req, res) => {
        const { id } = req.params;
        try {
            await db.prepare("DELETE FROM ca_tds_history WHERE id = ? AND ca_user_id = ?").run(id, req.user.id);
            return sendSuccess(res, null, 'TDS calculation deleted');
        } catch (error) {
            console.error('[CA deleteTdsCalculation Error]', error);
            return sendError(res, 'Failed to delete TDS calculation', 500);
        }
    },

    // --- Billing & Audit Session Methods (Phase 2 & Audit Description Workflow) ---
    addAuditSession: async (req, res) => {
        const { clientId, startTime, stopTime, endTime, durationSeconds, auditDate, auditDescription, description, hourlyRate = 500 } = req.body;
        try {
            await ensureSeededPracticeData(req.user.id);
            const now = new Date().toISOString();

            // 1. Resolve client record & Business Owner ID safely regardless of how clientId is passed
            let clientRecord = null;
            let businessOwnerId = null;

            if (clientId) {
                // Try finding by ca_clients PK ID if integer/numeric string
                clientRecord = await db.prepare("SELECT * FROM ca_clients WHERE id = ?").get(clientId);

                // Try finding by ca_clients name/email for this CA
                if (!clientRecord) {
                    clientRecord = await db.prepare("SELECT * FROM ca_clients WHERE (name = ? OR email = ? OR business_owner_id = ?) AND ca_user_id = ?").get(clientId, clientId, clientId, req.user.id);
                }

                // Try finding by general name/email
                if (!clientRecord) {
                    clientRecord = await db.prepare("SELECT * FROM ca_clients WHERE name = ? OR email = ?").get(clientId, clientId);
                }

                if (clientRecord && clientRecord.business_owner_id) {
                    businessOwnerId = clientRecord.business_owner_id;
                } else if (clientRecord && clientRecord.email) {
                    const u = await db.prepare("SELECT id FROM users WHERE email = ?").get(clientRecord.email);
                    if (u) businessOwnerId = u.id;
                }

                if (!businessOwnerId) {
                    const directUser = await db.prepare("SELECT id FROM users WHERE id = ? OR username = ? OR email = ?").get(clientId, clientId, clientId);
                    if (directUser) {
                        businessOwnerId = directUser.id;
                    }
                }
            }

            // Fallback: lookup connected Business Owner via accepted invitations
            if (!businessOwnerId) {
                const inv = await db.prepare("SELECT sender_id, receiver_id FROM ca_invitations WHERE (sender_id = ? OR receiver_id = ?) AND status = 'Accepted'").get(req.user.id, req.user.id);
                if (inv) {
                    businessOwnerId = inv.sender_id === req.user.id ? inv.receiver_id : inv.sender_id;
                }
            }

            // Fallback default: first business owner user
            if (!businessOwnerId) {
                const firstUser = await db.prepare("SELECT id FROM users WHERE role = 'business' OR role = 'user' LIMIT 1").get();
                businessOwnerId = firstUser?.id || 1;
            }

            const numericClientId = (clientRecord && clientRecord.id) ? clientRecord.id : null;

            // 2. Calculate duration and formatted timestamps
            let durationSec = parseInt(durationSeconds) || 0;
            const endTs = stopTime || endTime || now;
            if (!durationSec && startTime && endTs) {
                durationSec = Math.max(0, Math.floor((new Date(endTs).getTime() - new Date(startTime).getTime()) / 1000));
            }
            if (durationSec <= 0) durationSec = 60; // minimum 1 min fallback

            const sessionId = `AUD-SESS-${Date.now()}`;
            const invoiceNumber = `INV-PRO-${Date.now().toString().slice(-6)}`;
            const dateStr = auditDate || new Date().toISOString().split('T')[0];
            const descText = auditDescription || description || 'GST Return Filing (GSTR-1) & Audit Review';

            const startObj = startTime ? new Date(startTime) : new Date(Date.now() - durationSec * 1000);
            const endObj = endTs ? new Date(endTs) : new Date();
            const startTimeStr = !isNaN(startObj.getTime()) ? startObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '10:00:00 AM';
            const endTimeStr = !isNaN(endObj.getTime()) ? endObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '10:30:00 AM';

            const hrs = durationSec / 3600;
            const hRate = parseFloat(hourlyRate) || 500;
            const proFee = Math.max(100, Math.round(hrs * hRate));
            const gst = Math.round(proFee * 0.18);
            const total = proFee + gst;

            const durationMinsTotal = Math.ceil(durationSec / 60);
            const durationHrsComponent = Math.floor(durationMinsTotal / 60);
            const durationMinsComponent = durationMinsTotal % 60;
            const durationSecsComponent = durationSec % 60;

            let durationText = '';
            if (durationHrsComponent > 0) {
                durationText = `${durationHrsComponent} Hours ${durationMinsComponent} Minutes`;
            } else if (durationMinsComponent > 0) {
                durationText = `${durationMinsComponent} Minutes ${durationSecsComponent} Seconds`;
            } else {
                durationText = `${durationSec} Seconds`;
            }

            // Step 3: Insert into ca_audit_sessions
            const sessionRes = await db.prepare(`
                INSERT INTO ca_audit_sessions (
                    session_id, ca_user_id, client_id, business_owner_id, start_time, stop_time, end_time,
                    duration_seconds, audit_date, audit_description, hourly_rate, professional_fee,
                    gst_amount, grand_total, invoice_number, payment_status, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending Payment', 'Completed', ?)
            `).run(
                sessionId, req.user.id, numericClientId, businessOwnerId, startTimeStr, endTs, endTimeStr,
                durationSec, dateStr, descText, hRate, proFee, gst, total, invoiceNumber, now
            );
            const sessionDbId = sessionRes.lastInsertRowid;

            // Step 4: Insert into ca_professional_services
            await db.prepare(`
                INSERT INTO ca_professional_services (
                    ca_user_id, client_id, business_owner_id, audit_session_id,
                    audit_description, duration_seconds, duration_text, hourly_rate,
                    professional_fee, gst_amount, grand_total, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?)
            `).run(
                req.user.id, numericClientId, businessOwnerId, sessionDbId,
                descText, durationSec, durationText, hRate,
                proFee, gst, total, now
            );

            // Step 5: Automatically create Invoice in ca_professional_invoices
            const invRes = await db.prepare(`
                INSERT INTO ca_professional_invoices (
                    invoice_number, ca_user_id, business_owner_id, client_id, audit_session_id,
                    audit_description, start_time, end_time, hourly_rate, duration_text,
                    amount, gst_amount, total_amount, status, invoice_date, pdf_path, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending Payment', ?, ?, ?)
            `).run(
                invoiceNumber, req.user.id, businessOwnerId, numericClientId, sessionDbId,
                descText, startTimeStr, endTimeStr, hRate, durationText,
                proFee, gst, total, dateStr, `/invoices/${invoiceNumber}.pdf`, now
            );
            const invoiceDbId = invRes.lastInsertRowid;

            await db.prepare(`
                INSERT INTO invoice_items (invoice_id, description, quantity, rate, amount)
                VALUES (?, ?, 1, ?, ?)
            `).run(invoiceDbId, descText, proFee, proFee);

            // Step 6: Notify Business Owner for instant dashboard sync
            const caUser = await db.prepare("SELECT username, email FROM users WHERE id = ?").get(req.user.id);
            const caName = caUser?.username || caUser?.email || 'Your CA Advisor';
            const notifMsg = `New professional invoice "${invoiceNumber}" generated by ${caName} for ₹${total} (${descText}).`;
            await db.prepare(`
                INSERT INTO notifications (sender_id, receiver_id, user_id, type, title, message, is_read, created_at)
                VALUES (?, ?, ?, 'Professional Invoice Generated', 'New Audit Invoice Received', ?, 0, ?)
            `).run(req.user.id, businessOwnerId, businessOwnerId, notifMsg, now);

            return sendSuccess(res, {
                id: sessionDbId,
                sessionId,
                clientId: numericClientId,
                businessOwnerId,
                invoiceNumber,
                invoiceId: invoiceDbId,
                auditDescription: descText,
                startTime: startTimeStr,
                endTime: endTimeStr,
                durationSeconds: durationSec,
                durationText,
                hourlyRate: hRate,
                professionalFee: proFee,
                gstAmount: gst,
                grandTotal: total,
                auditDate: dateStr,
                status: 'Completed',
                paymentStatus: 'Pending Payment'
            }, 'Audit session saved & professional bill generated successfully');
        } catch (error) {
            console.error('[CA addAuditSession Error]', error);
            return sendError(res, 'Failed to save audit session: ' + error.message, 500);
        }
    },

    getAuditSessions: async (req, res) => {
        try {
            const list = await db.prepare(`
                SELECT s.*, c.name as client_name
                FROM ca_audit_sessions s
                LEFT JOIN ca_clients c ON s.client_id = c.id
                WHERE s.ca_user_id = ? OR s.business_owner_id = ?
                ORDER BY s.id DESC
            `).all(req.user.id, req.user.id);
            return sendSuccess(res, list, 'Audit sessions retrieved');
        } catch (error) {
            console.error('[CA getAuditSessions Error]', error);
            return sendError(res, 'Failed to fetch audit sessions', 500);
        }
    },

    generateProfessionalInvoice: async (req, res) => {
        const { sessionId, clientId, amount, gstAmount, totalAmount, invoiceDate, auditDescription, hourlyRate = 500 } = req.body;
        try {
            const now = new Date().toISOString();
            const invoiceNumber = `INV-PRO-${Date.now().toString().slice(-6)}`;

            const client = await db.prepare("SELECT business_owner_id, name FROM ca_clients WHERE id = ?").get(clientId);
            const businessOwnerId = client?.business_owner_id || req.body.businessOwnerId;
            if (!businessOwnerId) {
                return sendError(res, 'Client is not connected to a business owner account', 400);
            }

            let baseAmount = parseFloat(amount);
            let session = null;
            if (sessionId) {
                session = await db.prepare("SELECT * FROM ca_audit_sessions WHERE id = ? OR session_id = ?").get(sessionId, sessionId);
            }

            if ((isNaN(baseAmount) || baseAmount <= 0) && session) {
                baseAmount = session.professional_fee || Math.round(((session.duration_seconds || 0) / 3600) * (session.hourly_rate || 500));
            } else if (isNaN(baseAmount) || baseAmount <= 0) {
                baseAmount = 500;
            }

            const calculatedGst = parseFloat(gstAmount) || Math.round(baseAmount * 0.18);
            const calculatedTotal = parseFloat(totalAmount) || (baseAmount + calculatedGst);
            const descText = auditDescription || session?.audit_description || 'Professional CA Audit & Compliance Review';

            const result = await db.prepare(`
                INSERT INTO ca_professional_invoices (
                    invoice_number, ca_user_id, business_owner_id, client_id, audit_session_id,
                    audit_description, start_time, end_time, hourly_rate,
                    amount, gst_amount, total_amount, status, invoice_date, pdf_path, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Unpaid', ?, ?, ?)
            `).run(
                invoiceNumber, req.user.id, businessOwnerId, clientId || null, session?.id || null,
                descText, session?.start_time || '10:00 AM', session?.end_time || '11:45 AM', hourlyRate,
                baseAmount, calculatedGst, calculatedTotal, invoiceDate || now.split('T')[0], `/invoices/${invoiceNumber}.pdf`, now
            );

            const invoiceId = result.lastInsertRowid;

            await db.prepare(`
                INSERT INTO invoice_items (invoice_id, description, quantity, rate, amount)
                VALUES (?, ?, 1, ?, ?)
            `).run(invoiceId, descText, baseAmount, baseAmount);

            const caUser = await db.prepare("SELECT username, email FROM users WHERE id = ?").get(req.user.id);
            const caName = caUser?.username || caUser?.email || 'Your CA Advisor';
            const message = `New professional service invoice "${invoiceNumber}" generated by ${caName} for ₹${calculatedTotal}.`;
            await db.prepare(`
                INSERT INTO notifications (sender_id, receiver_id, user_id, type, title, message, is_read, created_at)
                VALUES (?, ?, ?, 'Professional Invoice Generated', 'New Invoice Received', ?, 0, ?)
            `).run(req.user.id, businessOwnerId, businessOwnerId, message, now);

            return sendSuccess(res, {
                id: invoiceId,
                invoiceNumber,
                amount: baseAmount,
                gstAmount: calculatedGst,
                totalAmount: calculatedTotal,
                status: 'Unpaid'
            }, 'Professional invoice generated successfully');
        } catch (error) {
            console.error('[CA generateProfessionalInvoice Error]', error);
            return sendError(res, 'Failed to generate invoice', 500);
        }
    },

    getProfessionalInvoices: async (req, res) => {
        try {
            const userId = req.user?.id || req.user?.userId;
            if (!userId) return sendSuccess(res, [], 'Professional invoices retrieved');

            let list = [];
            try {
                if (req.user?.role === 'business') {
                    list = await db.prepare(`
                        SELECT i.*, u.username as ca_name, s.duration_seconds, s.start_time, s.end_time, s.stop_time, s.audit_date, s.audit_description
                        FROM ca_professional_invoices i
                        LEFT JOIN users u ON i.ca_user_id = u.id
                        LEFT JOIN ca_audit_sessions s ON i.audit_session_id = s.id
                        WHERE i.business_owner_id = ?
                        ORDER BY i.id DESC
                    `).all(userId);
                } else {
                    list = await db.prepare(`
                        SELECT i.*, c.name as client_name, s.duration_seconds, s.start_time, s.end_time, s.stop_time, s.audit_date, s.audit_description
                        FROM ca_professional_invoices i
                        LEFT JOIN ca_clients c ON i.client_id = c.id
                        LEFT JOIN ca_audit_sessions s ON i.audit_session_id = s.id
                        WHERE i.ca_user_id = ?
                        ORDER BY i.id DESC
                    `).all(userId);
                }
            } catch (e) {
                list = [];
            }
            return sendSuccess(res, list || [], 'Professional invoices retrieved');
        } catch (error) {
            console.error('[CA getProfessionalInvoices Error]', error);
            return sendSuccess(res, [], 'Professional invoices retrieved');
        }
    },

    getProfessionalInvoicePdf: async (req, res) => {
        const { id } = req.params;
        try {
            const invoice = await db.prepare(`
                SELECT i.*, u.username as ca_name, u.email as ca_email, o.username as owner_name, o.email as owner_email,
                       s.duration_seconds, s.start_time, s.end_time, s.stop_time, s.audit_date, s.audit_description, s.hourly_rate
                FROM ca_professional_invoices i
                LEFT JOIN users u ON i.ca_user_id = u.id
                LEFT JOIN users o ON i.business_owner_id = o.id
                LEFT JOIN ca_audit_sessions s ON i.audit_session_id = s.id
                WHERE i.id = ? OR i.invoice_number = ?
            `).get(id, id);

            if (!invoice) return sendError(res, 'Invoice not found', 404);

            if (req.user.id === invoice.business_owner_id) {
                const now = new Date().toISOString();
                const notifMsg = `Invoice ${invoice.invoice_number} was viewed/downloaded by client ${invoice.owner_name || 'Business Owner'}.`;
                await db.prepare(`
                    INSERT INTO notifications (sender_id, receiver_id, user_id, type, title, message, is_read, created_at)
                    VALUES (?, ?, ?, 'Invoice Downloaded', 'Invoice Viewed / Downloaded', ?, 0, ?)
                `).run(req.user.id, invoice.ca_user_id, invoice.ca_user_id, notifMsg, now);
            }

            const durationSec = invoice.duration_seconds || 0;
            const durationMinsTotal = Math.ceil(durationSec / 60);
            const durationHrsComponent = Math.floor(durationMinsTotal / 60);
            const durationMinsComponent = durationMinsTotal % 60;
            const durationFormatted = durationHrsComponent > 0 
                ? `${durationHrsComponent}h ${durationMinsComponent}m` 
                : `${durationMinsComponent}m`;

            const descText = invoice.audit_description || invoice.auditDescription || 'GST Return Filing & Tax Compliance Review';
            const startTimeDisplay = invoice.start_time || '10:00 AM';
            const endTimeDisplay = invoice.end_time || '11:45 AM';
            const rateDisplay = invoice.hourly_rate || invoice.hourlyRate || 500;

            const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <title>Invoice ${invoice.invoice_number}</title>
                <style>
                    body { font-family: 'Helvetica Neue', Arial, sans-serif; margin: 40px; color: #1E293B; background: #FFF; }
                    .header { display: flex; justify-content: space-between; border-bottom: 2px solid #15803d; padding-bottom: 20px; }
                    .title { font-size: 24px; font-weight: 800; color: #15803d; }
                    .badge { background: ${invoice.status === 'Paid' ? '#DCFCE7' : '#FEF3C7'}; color: ${invoice.status === 'Paid' ? '#15803d' : '#D97706'}; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 700; }
                    .details { margin-top: 30px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
                    .table { width: 100%; border-collapse: collapse; margin-top: 30px; }
                    .table th, .table td { border: 1px solid #E2E8F0; padding: 12px; text-align: left; }
                    .table th { background: #F8FAFC; font-weight: 700; color: #475569; }
                    .totals { margin-top: 20px; text-align: right; }
                    .totals div { font-size: 14px; margin-bottom: 6px; }
                    .grand { font-size: 18px; font-weight: 800; color: #15803d; }
                </style>
            </head>
            <body>
                <div class="header">
                    <div>
                        <div class="title">CLIKS FIN-PRO AUDIT INVOICE</div>
                        <div style="color: #64748B; font-size: 13px; margin-top: 4px;">Invoice #${invoice.invoice_number}</div>
                    </div>
                    <div><span class="badge">${invoice.status}</span></div>
                </div>
                <div class="details">
                    <div>
                        <strong>CHARTERED ACCOUNTANT (ISSUER):</strong><br>
                        ${invoice.ca_name || 'CA Practice Manager'}<br>
                        ${invoice.ca_email || ''}
                    </div>
                    <div>
                        <strong>BUSINESS CLIENT (BILLED TO):</strong><br>
                        ${invoice.owner_name || 'Client'}<br>
                        ${invoice.owner_email || ''}
                    </div>
                </div>
                <table class="table">
                    <thead>
                        <tr>
                            <th>Audit Description</th>
                            <th>Start</th>
                            <th>End</th>
                            <th>Duration</th>
                            <th>Rate</th>
                            <th>Professional Fee</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td><strong>${descText}</strong></td>
                            <td>${startTimeDisplay}</td>
                            <td>${endTimeDisplay}</td>
                            <td>${durationFormatted}</td>
                            <td>₹${rateDisplay} / Hour</td>
                            <td>₹${invoice.amount}</td>
                        </tr>
                    </tbody>
                </table>
                <div class="totals">
                    <div>Professional Fee: ₹${invoice.amount}</div>
                    <div>GST (18%): ₹${invoice.gst_amount}</div>
                    <div class="grand">Grand Total: ₹${invoice.total_amount}</div>
                </div>
            </body>
            </html>`;

            res.setHeader('Content-Type', 'text/html');
            return res.send(htmlContent);
        } catch (error) {
            console.error('[CA getProfessionalInvoicePdf Error]', error);
            return sendError(res, 'Failed to fetch PDF', 500);
        }
    },

    payInvoice: async (req, res) => {
        const { id: invoiceId } = req.params;
        const { paymentMethod } = req.body;
        try {
            const now = new Date().toISOString();
            const invoice = await db.prepare("SELECT * FROM ca_professional_invoices WHERE id = ? AND business_owner_id = ?").get(invoiceId, req.user.id);
            if (!invoice) return sendError(res, 'Invoice not found', 404);

            if (invoice.status === 'Paid') {
                return sendSuccess(res, null, 'Invoice is already paid');
            }

            const paymentId = `PAY-${Date.now()}`;
            const txnId = `TXN-${Date.now()}`;
            const methodStr = paymentMethod || 'UPI';

            await db.prepare("UPDATE ca_professional_invoices SET status = 'Paid' WHERE id = ?").run(invoiceId);

            await db.prepare(`
                INSERT INTO ca_payments (payment_id, invoice_id, ca_user_id, user_id, amount, payment_method, transaction_id, status, paid_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'Success', ?, ?)
            `).run(paymentId, invoiceId, invoice.ca_user_id, req.user.id, invoice.total_amount, methodStr, txnId, now, now);

            // Notify CA of payment
            const ownerUser = await db.prepare("SELECT username, email FROM users WHERE id = ?").get(req.user.id);
            const ownerName = ownerUser?.username || ownerUser?.email || 'Business Owner';
            const payMessage = `Payment of ₹${invoice.total_amount} received via ${methodStr} from ${ownerName} for invoice ${invoice.invoice_number}. Reference: ${txnId}.`;
            await db.prepare(`
                INSERT INTO notifications (sender_id, receiver_id, user_id, type, title, message, is_read, created_at)
                VALUES (?, ?, ?, 'Payment Received', 'Payment Received', ?, 0, ?)
            `).run(req.user.id, invoice.ca_user_id, invoice.ca_user_id, payMessage, now);

            return sendSuccess(res, {
                paymentId,
                transactionId: txnId,
                amount: invoice.total_amount,
                paymentMethod: methodStr,
                status: 'Success',
                paidAt: now
            }, 'Payment processed successfully');
        } catch (error) {
            console.error('[CA payInvoice Error]', error);
            return sendError(res, 'Failed to process payment', 500);
        }
    },

    getPaymentHistory: async (req, res) => {
        try {
            const userId = req.user?.id || req.user?.userId;
            if (!userId) return sendSuccess(res, [], 'Payment history retrieved');

            let list = [];
            try {
                if (req.user?.role === 'business') {
                    list = await db.prepare(`
                        SELECT p.*, i.invoice_number, i.invoice_date, s.duration_seconds, u.username as ca_name
                        FROM ca_payments p
                        LEFT JOIN ca_professional_invoices i ON p.invoice_id = i.id
                        LEFT JOIN ca_audit_sessions s ON i.audit_session_id = s.id
                        LEFT JOIN users u ON p.ca_user_id = u.id
                        WHERE p.user_id = ?
                        ORDER BY p.id DESC
                    `).all(userId);
                } else {
                    list = await db.prepare(`
                        SELECT p.*, i.invoice_number, i.invoice_date, s.duration_seconds, c.name as client_name, o.username as owner_name
                        FROM ca_payments p
                        LEFT JOIN ca_professional_invoices i ON p.invoice_id = i.id
                        LEFT JOIN ca_audit_sessions s ON i.audit_session_id = s.id
                        LEFT JOIN ca_clients c ON i.client_id = c.id
                        LEFT JOIN users o ON p.user_id = o.id
                        WHERE p.ca_user_id = ?
                        ORDER BY p.id DESC
                    `).all(userId);
                }
            } catch (e) {
                list = [];
            }

            const mapped = (list || []).map(item => ({
                id: item.id,
                paymentId: item.payment_id || `PAY-${item.id}`,
                invoiceId: item.invoice_id,
                invoiceNumber: item.invoice_number || `INV-${item.invoice_id}`,
                invoiceDate: item.invoice_date,
                paidDate: item.paid_at || item.created_at,
                durationSeconds: item.duration_seconds || 0,
                durationMins: Math.ceil((item.duration_seconds || 0) / 60),
                amount: item.amount,
                paymentMethod: item.payment_method || 'Online',
                transactionId: item.transaction_id,
                status: item.status || 'Success',
                caName: item.ca_name,
                clientName: item.client_name || item.owner_name
            }));

            return sendSuccess(res, mapped, 'Payment history retrieved');
        } catch (error) {
            console.error('[CA getPaymentHistory Error]', error);
            return sendSuccess(res, [], 'Payment history retrieved');
        }
    },

    getTdsHistory: async (req, res) => {
        try {
            const userId = req.user?.id || req.user?.userId;
            if (!userId) return sendSuccess(res, [], 'TDS history retrieved');
            let list = [];
            try {
                list = await db.prepare("SELECT * FROM ca_tds_history WHERE ca_user_id = ? ORDER BY id DESC").all(userId);
            } catch (e) {
                list = [];
            }
            return sendSuccess(res, list || [], 'TDS history retrieved');
        } catch (error) {
            console.error('[CA getTdsHistory Error]', error);
            return sendSuccess(res, [], 'TDS history retrieved');
        }
    },

    saveTdsCalculation: async (req, res) => {
        try {
            const userId = req.user?.id || req.user?.userId;
            const { client_id, client_name, financial_year, section, amount, calculated_tds, payment_date, residential_status, recipient_category, pan_not_available, surcharge_rate } = req.body;
            const now = new Date().toISOString();

            const result = await db.prepare(`
                INSERT INTO ca_tds_history 
                (ca_user_id, client_id, client_name, financial_year, section, amount, calculated_tds, payment_date, residential_status, recipient_category, pan_not_available, surcharge_rate, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(userId, client_id || null, client_name || 'Walk-in Client', financial_year || '2026-27', section || '', amount || 0, calculated_tds || 0, payment_date || now.split('T')[0], residential_status || 'Resident', recipient_category || 'Individual', pan_not_available ? 1 : 0, surcharge_rate || 'Nil', now);

            return sendSuccess(res, { id: result.lastInsertRowid }, 'TDS calculation saved successfully');
        } catch (error) {
            console.error('[CA saveTdsCalculation Error]', error);
            return sendError(res, 'Failed to save TDS calculation', 500);
        }
    },

    updateTdsCalculation: async (req, res) => {
        try {
            const { id } = req.params;
            const { financial_year, section, amount, calculated_tds, payment_date, residential_status, recipient_category, pan_not_available, surcharge_rate } = req.body;

            await db.prepare(`
                UPDATE ca_tds_history
                SET financial_year = ?, section = ?, amount = ?, calculated_tds = ?, payment_date = ?, residential_status = ?, recipient_category = ?, pan_not_available = ?, surcharge_rate = ?
                WHERE id = ?
            `).run(financial_year, section, amount, calculated_tds, payment_date, residential_status, recipient_category, pan_not_available ? 1 : 0, surcharge_rate, id);

            return sendSuccess(res, { id: parseInt(id) }, 'TDS calculation updated successfully');
        } catch (error) {
            console.error('[CA updateTdsCalculation Error]', error);
            return sendError(res, 'Failed to update TDS calculation', 500);
        }
    },

    deleteTdsCalculation: async (req, res) => {
        try {
            const { id } = req.params;
            await db.prepare("DELETE FROM ca_tds_history WHERE id = ?").run(id);
            return sendSuccess(res, { id: parseInt(id) }, 'TDS calculation deleted successfully');
        } catch (error) {
            console.error('[CA deleteTdsCalculation Error]', error);
            return sendError(res, 'Failed to delete TDS calculation', 500);
        }
    },

    getEarningsDashboard: async (req, res) => {
        try {
            const userId = req.user.id;
            const now = new Date();
            const today = now.toISOString().split('T')[0];

            // This Week
            const weekAgo = new Date();
            weekAgo.setDate(now.getDate() - 7);
            const weekAgoStr = weekAgo.toISOString().split('T')[0];

            // This Month
            const monthAgo = new Date();
            monthAgo.setDate(now.getDate() - 30);
            const monthAgoStr = monthAgo.toISOString().split('T')[0];

            const pending = await db.prepare("SELECT SUM(total_amount) as total FROM ca_professional_invoices WHERE ca_user_id = ? AND status = 'Unpaid'").get(userId);
            const paid = await db.prepare("SELECT SUM(total_amount) as total FROM ca_professional_invoices WHERE ca_user_id = ? AND status = 'Paid'").get(userId);
            const total = await db.prepare("SELECT SUM(total_amount) as total FROM ca_professional_invoices WHERE ca_user_id = ?").get(userId);
            const todayEarnings = await db.prepare("SELECT SUM(total_amount) as total FROM ca_professional_invoices WHERE ca_user_id = ? AND invoice_date = ?").get(userId, today);
            const weekEarnings = await db.prepare("SELECT SUM(total_amount) as total FROM ca_professional_invoices WHERE ca_user_id = ? AND invoice_date >= ?").get(userId, weekAgoStr);
            const monthEarnings = await db.prepare("SELECT SUM(total_amount) as total FROM ca_professional_invoices WHERE ca_user_id = ? AND invoice_date >= ?").get(userId, monthAgoStr);

            // Audit hours
            const auditHoursRes = await db.prepare("SELECT SUM(duration_seconds) as total_sec FROM ca_audit_sessions WHERE ca_user_id = ?").get(userId);
            const totalAuditHours = ((auditHoursRes?.total_sec || 0) / 3600).toFixed(1);

            // Client count for average calculation
            const clientCountRes = await db.prepare("SELECT COUNT(DISTINCT client_id) as cnt FROM ca_professional_invoices WHERE ca_user_id = ?").get(userId);
            const clientCnt = clientCountRes?.cnt || 1;
            const averageBillingPerClient = Math.round((total?.total || 0) / clientCnt);

            return sendSuccess(res, {
                today: todayEarnings?.total || 0,
                thisWeek: weekEarnings?.total || 0,
                thisMonth: monthEarnings?.total || 0,
                pending: pending?.total || 0,
                paid: paid?.total || 0,
                totalRevenue: total?.total || 0,
                totalAuditHours: parseFloat(totalAuditHours),
                averageBillingPerClient
            }, 'Earnings summary retrieved');
        } catch (error) {
            console.error('[CA getEarningsDashboard Error]', error);
            return sendError(res, 'Failed to fetch earnings summary', 500);
        }
    },

    updateTask: async (req, res) => {
        const { id } = req.params;
        const { title, description, priority, dueDate, status } = req.body;
        try {
            const email = req.user.email || '';
            const task = await db.prepare(`
                SELECT * FROM ca_tasks 
                WHERE id = ? AND (
                    ca_user_id = ? 
                    OR business_owner_id = ? 
                    OR client_id = ?
                    OR LOWER(client_email) = LOWER(?)
                    OR LOWER(client_name) = LOWER(?)
                )
            `).get(id, req.user.id, req.user.id, req.user.id, email, email);

            if (!task) return sendError(res, 'Task not found or unauthorized', 404);

            const now = new Date().toISOString();
            const updatedTitle = title !== undefined ? title : task.title;
            const updatedDesc = description !== undefined ? description : (task.task_description || task.title);
            const updatedPriority = priority !== undefined ? priority : task.priority;
            const updatedDueDate = dueDate !== undefined ? dueDate : task.due_date;
            const updatedStatus = status !== undefined ? status : task.status;

            await db.prepare(`
                UPDATE ca_tasks 
                SET title = ?, task_description = ?, priority = ?, due_date = ?, status = ?, updated_at = ?
                WHERE id = ?
            `).run(updatedTitle, updatedDesc, updatedPriority, updatedDueDate, updatedStatus, now, id);

            return sendSuccess(res, {
                id: parseInt(id),
                taskId: parseInt(id),
                title: updatedTitle,
                taskDescription: updatedDesc,
                priority: updatedPriority,
                dueDate: updatedDueDate,
                status: updatedStatus,
                updatedAt: now
            }, 'Task updated successfully');
        } catch (error) {
            console.error('[CA updateTask Error]', error);
            return sendError(res, 'Failed to update task', 500);
        }
    },

    deleteTask: async (req, res) => {
        const { id } = req.params;
        try {
            const email = req.user.email || '';
            const task = await db.prepare(`
                SELECT * FROM ca_tasks 
                WHERE id = ? AND (
                    ca_user_id = ? 
                    OR business_owner_id = ? 
                    OR client_id = ?
                    OR LOWER(client_email) = LOWER(?)
                    OR LOWER(client_name) = LOWER(?)
                )
            `).get(id, req.user.id, req.user.id, req.user.id, email, email);

            if (!task) return sendError(res, 'Task not found or unauthorized', 404);

            await db.prepare("DELETE FROM ca_tasks WHERE id = ?").run(id);
            return sendSuccess(res, { id: parseInt(id) }, 'Task deleted successfully');
        } catch (error) {
            console.error('[CA deleteTask Error]', error);
            return sendError(res, 'Failed to delete task', 500);
        }
    },

    getNotifications: async (req, res) => {
        try {
            const userId = req.user?.id || req.user?.userId;
            if (!userId) {
                return sendSuccess(res, [], 'Notifications retrieved');
            }

            let list = [];
            try {
                list = await db.prepare(`
                    SELECT * FROM notifications 
                    WHERE receiver_id = ? OR user_id = ?
                    ORDER BY id DESC
                    LIMIT 100
                `).all(userId, userId);
            } catch (e) {
                try {
                    list = await db.prepare(`
                        SELECT * FROM notifications 
                        WHERE user_id = ?
                        ORDER BY id DESC
                        LIMIT 100
                    `).all(userId);
                } catch (e2) {
                    list = [];
                }
            }

            const mapped = (list || []).map(n => {
                let timeStr = 'Recently';
                if (n.created_at) {
                    try {
                        const parsedDate = new Date(n.created_at);
                        if (!isNaN(parsedDate.getTime())) {
                            timeStr = parsedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        }
                    } catch (e) {}
                }

                return {
                    id: n.id,
                    senderId: n.sender_id,
                    receiverId: n.receiver_id || n.user_id,
                    type: n.type || 'Info',
                    title: n.title || 'Notification',
                    message: n.message || '',
                    relatedTaskId: n.related_task_id,
                    isRead: n.is_read === 1 || n.is_read === true || n.is_read === 'true',
                    text: n.message || n.title || '',
                    time: timeStr,
                    read: n.is_read === 1 || n.is_read === true || n.is_read === 'true',
                    createdAt: n.created_at || new Date().toISOString()
                };
            });

            return sendSuccess(res, mapped, 'Notifications retrieved');
        } catch (error) {
            console.error('[CA getNotifications Error]', error);
            return sendSuccess(res, [], 'Notifications retrieved');
        }
    },

    addNotification: async (req, res) => {
        const { receiverId, type, title, message, relatedTaskId } = req.body;
        if (!title || !message) return sendError(res, 'Title and message are required', 400);

        try {
            const targetUserId = receiverId || req.user.id;
            const now = new Date().toISOString();
            const result = await db.prepare(`
                INSERT INTO notifications (sender_id, receiver_id, user_id, type, title, message, related_task_id, is_read, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
            `).run(req.user.id, targetUserId, targetUserId, type || 'Info', title, message, relatedTaskId || null, now);

            return sendSuccess(res, {
                id: result.lastInsertRowid,
                senderId: req.user.id,
                receiverId: targetUserId,
                type: type || 'Info',
                title,
                message,
                relatedTaskId: relatedTaskId || null,
                isRead: false,
                createdAt: now
            }, 'Notification created successfully');
        } catch (error) {
            console.error('[CA addNotification Error]', error);
            return sendError(res, 'Failed to create notification', 500);
        }
    },

    markNotificationRead: async (req, res) => {
        const { id } = req.params;
        try {
            const userId = req.user.id;
            await db.prepare(`
                UPDATE notifications 
                SET is_read = 1 
                WHERE id = ? AND (receiver_id = ? OR user_id = ?)
            `).run(id, userId, userId);

            return sendSuccess(res, { id: parseInt(id), isRead: true }, 'Notification marked as read');
        } catch (error) {
            console.error('[CA markNotificationRead Error]', error);
            return sendError(res, 'Failed to update notification', 500);
        }
    },

    markAllNotificationsRead: async (req, res) => {
        try {
            const userId = req.user.id;
            await db.prepare(`
                UPDATE notifications 
                SET is_read = 1 
                WHERE receiver_id = ? OR user_id = ?
            `).run(userId, userId);

            return sendSuccess(res, null, 'All notifications marked as read');
        } catch (error) {
            console.error('[CA markAllNotificationsRead Error]', error);
            return sendError(res, 'Failed to update notifications', 500);
        }
    },

    getPresenceStatus: async (req, res) => {
        try {
            const userIdParam = req.query.user_id ? parseInt(req.query.user_id) : null;
            const now = new Date();
            const timeoutThreshold = new Date(Date.now() - 90 * 1000).toISOString();

            // Auto cleanup stale online statuses older than 120s
            try {
                await db.prepare(`
                    UPDATE user_presence 
                    SET status = 'Offline', logout_time = ? 
                    WHERE status = 'Online' AND (last_activity < ? OR last_activity IS NULL)
                `).run(now.toISOString(), timeoutThreshold);
                await db.prepare(`
                    UPDATE users 
                    SET is_online = 0 
                    WHERE is_online = 1 AND (last_seen_at < ? OR last_seen_at IS NULL)
                `).run(timeoutThreshold);
            } catch(e) {}

            let targetId = userIdParam;

            // Resolve targetId if passed as client name or ca_clients PK ID
            if (targetId) {
                const caClient = await db.prepare("SELECT * FROM ca_clients WHERE id = ? OR name = ? OR email = ?").get(targetId, targetId, targetId);
                if (caClient) {
                    if (caClient.business_owner_id) {
                        targetId = caClient.business_owner_id;
                    } else if (caClient.email) {
                        const userByEmail = await db.prepare("SELECT id FROM users WHERE email = ?").get(caClient.email);
                        if (userByEmail) targetId = userByEmail.id;
                    }
                }
            }

            // If targetId not passed, lookup connected partner from ca_invitations or ca_clients
            if (!targetId) {
                const connectedInv = await db.prepare(`
                    SELECT sender_id, receiver_id FROM ca_invitations 
                    WHERE (sender_id = ? OR receiver_id = ?) AND status = 'Accepted'
                    ORDER BY id DESC LIMIT 1
                `).get(req.user.id, req.user.id);

                if (connectedInv) {
                    targetId = connectedInv.sender_id === req.user.id ? connectedInv.receiver_id : connectedInv.sender_id;
                } else {
                    const firstClient = await db.prepare("SELECT business_owner_id FROM ca_clients WHERE ca_user_id = ? AND business_owner_id IS NOT NULL LIMIT 1").get(req.user.id);
                    if (firstClient) targetId = firstClient.business_owner_id;
                }
            }

            if (targetId) {
                const presence = await db.prepare("SELECT * FROM user_presence WHERE user_id = ?").get(targetId);
                const user = await db.prepare("SELECT is_online, last_seen_at FROM users WHERE id = ?").get(targetId);

                const isOnline = (user?.is_online === 1) || (presence?.status === 'Online');
                const lastActivityTime = presence?.last_activity || user?.last_seen_at || presence?.logout_time || null;

                return sendSuccess(res, {
                    userId: targetId,
                    status: isOnline ? 'Online' : 'Offline',
                    loginTime: presence?.login_time || null,
                    lastActivity: lastActivityTime,
                    logoutTime: presence?.logout_time || null
                }, 'Presence status retrieved');
            }

            // Fallback: Return current user presence
            const currentPresence = await db.prepare("SELECT * FROM user_presence WHERE user_id = ?").get(req.user.id);
            return sendSuccess(res, {
                userId: req.user.id,
                status: 'Online',
                lastActivity: currentPresence?.last_activity || new Date().toISOString()
            }, 'Presence status retrieved');
        } catch (error) {
            console.error('[CA getPresenceStatus Error]', error);
            return sendError(res, 'Failed to fetch presence status', 500);
        }
    },

    setUserOnline: async (req, res) => {
        try {
            const userId = req.user.id;
            const now = new Date().toISOString();
            const existing = await db.prepare("SELECT * FROM user_presence WHERE user_id = ?").get(userId);

            if (existing) {
                await db.prepare(`
                    UPDATE user_presence 
                    SET status = 'Online', login_time = ?, last_activity = ?, logout_time = NULL 
                    WHERE user_id = ?
                `).run(now, now, userId);
            } else {
                await db.prepare(`
                    INSERT INTO user_presence (user_id, user_type, login_time, last_activity, status)
                    VALUES (?, ?, ?, ?, 'Online')
                `).run(userId, req.user.role || 'user', now, now);
            }

            await db.prepare("UPDATE users SET is_online = 1, login_at = ?, last_seen_at = ? WHERE id = ?").run(now, now, userId);

            return sendSuccess(res, { userId, status: 'Online', loginTime: now }, 'User online presence updated');
        } catch (error) {
            console.error('[CA setUserOnline Error]', error);
            return sendError(res, 'Failed to set online status', 500);
        }
    },

    setUserOffline: async (req, res) => {
        try {
            const userId = req.user.id;
            const now = new Date().toISOString();
            const existing = await db.prepare("SELECT * FROM user_presence WHERE user_id = ?").get(userId);

            if (existing) {
                await db.prepare(`
                    UPDATE user_presence 
                    SET status = 'Offline', logout_time = ? 
                    WHERE user_id = ?
                `).run(now, userId);
            } else {
                await db.prepare(`
                    INSERT INTO user_presence (user_id, user_type, logout_time, status)
                    VALUES (?, ?, ?, 'Offline')
                `).run(userId, req.user.role || 'user', now);
            }

            await db.prepare("UPDATE users SET is_online = 0, last_seen_at = ? WHERE id = ?").run(now, userId);

            return sendSuccess(res, { userId, status: 'Offline', logoutTime: now }, 'User offline presence updated');
        } catch (error) {
            console.error('[CA setUserOffline Error]', error);
            return sendError(res, 'Failed to set offline status', 500);
        }
    },

    updatePresenceHeartbeat: async (req, res) => {
        try {
            const userId = req.user.id;
            const now = new Date().toISOString();
            await db.prepare(`
                UPDATE user_presence 
                SET status = 'Online', last_activity = ? 
                WHERE user_id = ?
            `).run(now, userId);

            await db.prepare("UPDATE users SET is_online = 1, last_seen_at = ? WHERE id = ?").run(now, userId);
            return sendSuccess(res, { userId, status: 'Online', lastActivity: now }, 'Heartbeat updated');
        } catch (error) {
            return sendError(res, 'Failed to update heartbeat', 500);
        }
    },

    getGstCredentials: async (req, res) => {
        try {
            const userId = req.user.id;
            let record = await db.prepare(`
                SELECT * FROM gst_credentials 
                WHERE business_owner_id = ? OR connected_ca_id = ?
                ORDER BY id DESC LIMIT 1
            `).get(userId, userId);

            if (!record) {
                // Fallback check on users table
                const user = await db.prepare("SELECT gst_username, gst_password, gst_share_status, gst_shared_at, gst_connected_advisor_id FROM users WHERE id = ?").get(userId);
                if (user && user.gst_username) {
                    record = {
                        business_owner_id: userId,
                        connected_ca_id: user.gst_connected_advisor_id,
                        gst_username: user.gst_username,
                        encrypted_password: user.gst_password,
                        shared_status: user.gst_share_status || 'Not Shared',
                        shared_date: user.gst_shared_at,
                        revoked_date: null
                    };
                }
            }

            if (!record) {
                return sendSuccess(res, {
                    gstUsername: '',
                    sharedStatus: 'Not Shared',
                    isShared: false,
                    passwordAvailable: false
                }, 'No GST credentials stored');
            }

            const isOwner = record.business_owner_id === userId;
            const isCA = record.connected_ca_id === userId || !isOwner;
            const isShared = record.shared_status === 'Shared';

            let decryptedPassword = null;
            if (isOwner || (isCA && isShared)) {
                decryptedPassword = decrypt(record.encrypted_password) || record.encrypted_password;
            }

            if (isCA && isShared) {
                // Log access to ca_gst_access_logs
                const caUser = await db.prepare("SELECT username FROM users WHERE id = ?").get(userId);
                const ownerUser = await db.prepare("SELECT username, business_name FROM users WHERE id = ?").get(record.business_owner_id);
                await db.prepare(`
                    INSERT INTO ca_gst_access_logs (ca_user_id, client_id, ca_name, client_name, accessed_at, action)
                    VALUES (?, ?, ?, ?, ?, 'view')
                `).run(userId, record.business_owner_id, caUser?.username || 'CA', ownerUser?.business_name || ownerUser?.username || 'Client', new Date().toISOString());
            }

            return sendSuccess(res, {
                id: record.id,
                businessOwnerId: record.business_owner_id,
                connectedCaId: record.connected_ca_id,
                gstUsername: record.gst_username || '',
                gstPassword: decryptedPassword || (isOwner ? '' : '••••••••'),
                sharedStatus: record.shared_status || 'Not Shared',
                isShared,
                sharedDate: record.shared_date,
                revokedDate: record.revoked_date
            }, 'GST credentials retrieved');
        } catch (error) {
            console.error('[CA getGstCredentials Error]', error);
            return sendError(res, 'Failed to fetch GST credentials', 500);
        }
    },

    saveGstCredentials: async (req, res) => {
        const { gstUsername, gstPassword, connectedCaId } = req.body;
        if (!gstUsername || !gstPassword) {
            return sendError(res, 'GST Username and Password are required', 400);
        }

        try {
            const userId = req.user.id;
            const encryptedPassword = encrypt(gstPassword);
            const now = new Date().toISOString();

            // Find connected CA if not explicitly passed
            let caId = connectedCaId;
            if (!caId) {
                const inv = await db.prepare(`
                    SELECT sender_id, receiver_id FROM ca_invitations 
                    WHERE (sender_id = ? OR receiver_id = ?) AND status = 'Accepted'
                    ORDER BY id DESC LIMIT 1
                `).get(userId, userId);
                if (inv) {
                    caId = inv.sender_id === userId ? inv.receiver_id : inv.sender_id;
                }
            }

            const existing = await db.prepare("SELECT * FROM gst_credentials WHERE business_owner_id = ?").get(userId);

            if (existing) {
                await db.prepare(`
                    UPDATE gst_credentials 
                    SET gst_username = ?, encrypted_password = ?, connected_ca_id = ?, shared_status = 'Shared', shared_date = ?, revoked_date = NULL, updated_at = ?
                    WHERE business_owner_id = ?
                `).run(gstUsername, encryptedPassword, caId || existing.connected_ca_id, now, now, userId);
            } else {
                await db.prepare(`
                    INSERT INTO gst_credentials (business_owner_id, connected_ca_id, gst_username, encrypted_password, shared_status, shared_date, created_at, updated_at)
                    VALUES (?, ?, ?, ?, 'Shared', ?, ?, ?)
                `).run(userId, caId || null, gstUsername, encryptedPassword, now, now, now);
            }

            // Sync user profile
            await db.prepare(`
                UPDATE users 
                SET gst_username = ?, gst_password = ?, gst_share_status = 'Shared', gst_shared_at = ?, gst_connected_advisor_id = ?
                WHERE id = ?
            `).run(gstUsername, encryptedPassword, now, caId || null, userId);

            // Create notification for connected CA
            if (caId) {
                const owner = await db.prepare("SELECT username, business_name FROM users WHERE id = ?").get(userId);
                const ownerName = owner?.business_name || owner?.username || 'Business Owner';
                const messageText = `Business Owner ${ownerName} has saved and shared GST Portal credentials with you.`;
                await db.prepare(`
                    INSERT INTO notifications (sender_id, receiver_id, user_id, type, title, message, is_read, created_at)
                    VALUES (?, ?, ?, 'GST Credential Shared', 'GST Portal Credentials Shared', ?, 0, ?)
                `).run(userId, caId, caId, messageText, now);
            }

            return sendSuccess(res, {
                gstUsername,
                sharedStatus: 'Shared',
                isShared: true,
                sharedDate: now
            }, 'GST credentials saved and shared with CA');
        } catch (error) {
            console.error('[CA saveGstCredentials Error]', error);
            return sendError(res, 'Failed to save GST credentials', 500);
        }
    },

    requestGstCredentials: async (req, res) => {
        try {
            const caId = req.user.id;
            let { clientId } = req.body;

            // Find business owner ID
            let ownerId = clientId;
            const clientRecord = await db.prepare("SELECT business_owner_id FROM ca_clients WHERE id = ? AND ca_user_id = ?").get(clientId, caId);
            if (clientRecord && clientRecord.business_owner_id) {
                ownerId = clientRecord.business_owner_id;
            }

            if (!ownerId) {
                const inv = await db.prepare(`
                    SELECT sender_id FROM ca_invitations 
                    WHERE receiver_id = ? AND status = 'Accepted' 
                    ORDER BY id DESC LIMIT 1
                `).get(caId);
                if (inv) ownerId = inv.sender_id;
            }

            if (!ownerId) return sendError(res, 'Target client business owner not found', 404);

            const now = new Date().toISOString();
            const existing = await db.prepare("SELECT * FROM gst_credentials WHERE business_owner_id = ?").get(ownerId);

            if (existing) {
                await db.prepare(`
                    UPDATE gst_credentials 
                    SET connected_ca_id = ?, shared_status = 'Requested', updated_at = ?
                    WHERE business_owner_id = ?
                `).run(caId, now, ownerId);
            } else {
                await db.prepare(`
                    INSERT INTO gst_credentials (business_owner_id, connected_ca_id, gst_username, encrypted_password, shared_status, created_at, updated_at)
                    VALUES (?, ?, '', '', 'Requested', ?, ?)
                `).run(ownerId, caId, now, now);
            }

            // Sync user table
            await db.prepare(`
                UPDATE users SET gst_share_status = 'Requested', gst_connected_advisor_id = ? WHERE id = ?
            `).run(caId, ownerId);

            // Insert notification for Business Owner
            const caUser = await db.prepare("SELECT username FROM users WHERE id = ?").get(caId);
            const caName = caUser?.username || 'Your CA Advisor';
            const messageText = `${caName} has requested access to your GST Portal credentials for compliance review.`;
            await db.prepare(`
                INSERT INTO notifications (sender_id, receiver_id, user_id, type, title, message, is_read, created_at)
                VALUES (?, ?, ?, 'GST Credential Request', 'GST Credentials Requested', ?, 0, ?)
            `).run(caId, ownerId, ownerId, messageText, now);

            return sendSuccess(res, { sharedStatus: 'Requested' }, 'GST credentials requested from client');
        } catch (error) {
            console.error('[CA requestGstCredentials Error]', error);
            return sendError(res, 'Failed to request GST credentials', 500);
        }
    },

    revokeGstCredentials: async (req, res) => {
        try {
            const userId = req.user.id;
            const now = new Date().toISOString();

            await db.prepare(`
                UPDATE gst_credentials 
                SET shared_status = 'Revoked', revoked_date = ?, updated_at = ?
                WHERE business_owner_id = ?
            `).run(now, now, userId);

            await db.prepare(`
                UPDATE users 
                SET gst_share_status = 'Revoked' 
                WHERE id = ?
            `).run(userId);

            return sendSuccess(res, { sharedStatus: 'Revoked', revokedDate: now }, 'GST credentials sharing revoked');
        } catch (error) {
            console.error('[CA revokeGstCredentials Error]', error);
            return sendError(res, 'Failed to revoke GST credentials', 500);
        }
    },

    // --- Direct Messenger Chat Endpoints ---
    getChatMessages: async (req, res) => {
        try {
            const { partnerId } = req.params;
            const currentUserId = req.user.id;

            // Resolve target user ID and associated client ID
            let resolvedUserId = partnerId;
            let clientId = partnerId;

            // Check if partnerId is a ca_clients row ID
            const caClient = await db.prepare("SELECT * FROM ca_clients WHERE id = ?").get(partnerId);
            if (caClient) {
                if (caClient.business_owner_id) {
                    resolvedUserId = caClient.business_owner_id;
                } else if (caClient.email) {
                    const userByEmail = await db.prepare("SELECT id FROM users WHERE email = ?").get(caClient.email);
                    if (userByEmail) resolvedUserId = userByEmail.id;
                }
            } else {
                // Check if partnerId is a business owner user ID, find ca_clients record
                const clientRecord = await db.prepare("SELECT id FROM ca_clients WHERE (business_owner_id = ? OR email = (SELECT email FROM users WHERE id = ?)) AND ca_user_id = ?").get(partnerId, partnerId, currentUserId);
                if (clientRecord) clientId = clientRecord.id;
            }

            // Mark unread messages from this partner/client as read
            await db.prepare(`
                UPDATE ca_messages 
                SET is_read = 1 
                WHERE receiver_id = ? AND (sender_id = ? OR sender_id = ? OR sender_id = ?)
            `).run(currentUserId, partnerId, resolvedUserId, clientId);

            const messages = await db.prepare(`
                SELECT m.*, u.username as sender_name 
                FROM ca_messages m 
                LEFT JOIN users u ON m.sender_id = u.id 
                WHERE (
                    (m.sender_id = ? AND (m.receiver_id = ? OR m.receiver_id = ? OR m.receiver_id = ?))
                    OR
                    ((m.sender_id = ? OR m.sender_id = ? OR m.sender_id = ?) AND m.receiver_id = ?)
                )
                ORDER BY m.id ASC
            `).all(
                currentUserId, partnerId, resolvedUserId, clientId,
                partnerId, resolvedUserId, clientId, currentUserId
            );

            return sendSuccess(res, messages, 'Chat messages retrieved successfully');
        } catch (error) {
            console.error('[CA getChatMessages Error]', error);
            return sendError(res, 'Failed to fetch chat messages', 500);
        }
    },

    sendChatMessage: async (req, res) => {
        try {
            const { receiverId, message } = req.body;
            const senderId = req.user.id;

            if (!receiverId || !message || !message.trim()) {
                return sendError(res, 'Receiver ID and non-empty message are required', 400);
            }

            // Resolve target user ID if receiverId is a ca_clients row ID
            let targetUserId = receiverId;
            const caClient = await db.prepare("SELECT * FROM ca_clients WHERE id = ?").get(receiverId);
            if (caClient) {
                if (caClient.business_owner_id) {
                    targetUserId = caClient.business_owner_id;
                } else if (caClient.email) {
                    const userByEmail = await db.prepare("SELECT id FROM users WHERE email = ?").get(caClient.email);
                    if (userByEmail) targetUserId = userByEmail.id;
                }
            }

            const now = new Date().toISOString();
            const result = await db.prepare(`
                INSERT INTO ca_messages (sender_id, receiver_id, message, is_read, created_at)
                VALUES (?, ?, ?, 0, ?)
            `).run(senderId, targetUserId, message.trim(), now);

            const newMsg = await db.prepare('SELECT * FROM ca_messages WHERE id = ?').get(result.lastInsertRowid);

            return sendSuccess(res, newMsg, 'Message sent successfully');
        } catch (error) {
            console.error('[CA sendChatMessage Error]', error);
            return sendError(res, 'Failed to send chat message', 500);
        }
    },

    getUnreadChatCount: async (req, res) => {
        try {
            const currentUserId = req.user.id;
            const row = await db.prepare(`
                SELECT count(*) as count FROM ca_messages WHERE receiver_id = ? AND is_read = 0
            `).get(currentUserId);

            return sendSuccess(res, { unreadCount: row?.count || 0 }, 'Unread count fetched');
        } catch (error) {
            console.error('[CA getUnreadChatCount Error]', error);
            return sendError(res, 'Failed to fetch unread message count', 500);
        }
    }
};

module.exports = caController;
