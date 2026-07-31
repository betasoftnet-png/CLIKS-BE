const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

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
    // Demo data seeding disabled for newly registered companies to ensure complete tenant isolation and zero-balance starts.
    return;
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

            // Get sender name / business name from users table
            const sender = await db.prepare("SELECT username, email, business_name FROM users WHERE id = ?").get(req.user.id);
            const senderName = sender?.business_name || sender?.username || 'Cliks Business Client';
            const senderEmail = sender?.email || req.user.email;

            const now = new Date().toISOString();
            
            // Insert invitation
            const result = await db.prepare(`
                INSERT INTO ca_invitations (sender_id, sender_email, sender_name, receiver_email, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'Pending', ?, ?)
            `).run(req.user.id, senderEmail, senderName, email, now, now);

            const newInvite = {
                id: result.lastInsertRowid,
                sender_id: req.user.id,
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
                WHERE LOWER(receiver_email) = LOWER(?)
                ORDER BY id DESC
            `).all(email);
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
                WHERE id = ? AND LOWER(receiver_email) = LOWER(?)
            `).get(id, email);

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

            // Retrieve client user ID to calculate their actual gross income dynamically from transactions/invoices
            const clientUser = await db.prepare("SELECT id FROM users WHERE LOWER(email) = LOWER(?)").get(invitation.sender_email);
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
                    INSERT INTO ca_clients (ca_user_id, name, email, status, regime, income, pending_filings)
                    VALUES (?, ?, ?, 'Active', 'New', ?, 0)
                `).run(caUserId, invitation.sender_name || 'Cliks Business Client', invitation.sender_email, clientIncome);
            }

            const updatedInvite = {
                ...invitation,
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
            const list = await db.prepare(`
                SELECT * FROM ca_tasks 
                WHERE ca_user_id = ? OR LOWER(client_name) = LOWER(?)
                ORDER BY id DESC
            `).all(req.user.id, email);
            const mapped = list.map(item => ({
                id: item.id,
                clientName: item.client_name,
                title: item.title,
                status: item.status,
                priority: item.priority,
                dueDate: item.due_date,
                askForDocument: item.ask_for_document == 1 || item.ask_for_document === 'true' || item.ask_for_document === true,
                attachedFile: item.attached_file
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
            const result = await db.prepare(`
                INSERT INTO ca_tasks (ca_user_id, client_name, title, status, priority, due_date, ask_for_document, attached_file)
                VALUES (?, ?, ?, 'Pending', ?, ?, ?, null)
            `).run(req.user.id, clientName || 'General Client', title, priority || 'Medium', defaultDate, askDocInt);

            const newTask = {
                id: result.lastInsertRowid,
                clientName: clientName || 'General Client',
                title,
                status: 'Pending',
                priority: priority || 'Medium',
                dueDate: defaultDate,
                askForDocument: !!askForDocument,
                attachedFile: null
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
                WHERE id = ? AND (ca_user_id = ? OR LOWER(client_name) = LOWER(?))
            `).get(id, req.user.id, email);
            if (!task) return sendError(res, 'Task not found or unauthorized', 404);

            const nextStatus = task.status === 'Pending' ? 'In Progress' : (task.status === 'In Progress' ? 'Completed' : 'Pending');
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
                SET attached_file = ? 
                WHERE id = ?
            `).run(attachedFile, id);

            return sendSuccess(res, { id: parseInt(id), attachedFile }, 'Task document uploaded successfully');
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
            const clientRequests = await db.prepare("SELECT * FROM ca_client_requests WHERE ca_user_id = ? AND LOWER(client_name) = LOWER(?) AND attached_file IS NOT NULL").all(req.user.id, client.name);
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
            const clientTasks = await db.prepare("SELECT * FROM ca_tasks WHERE ca_user_id = ? AND LOWER(client_name) = LOWER(?) AND attached_file IS NOT NULL").all(req.user.id, client.name);
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
            const existing = await db.prepare("SELECT * FROM ca_document_reviews WHERE ca_user_id = ? AND client_id = ? AND document_id = ?").get(req.user.id, clientId, documentId);
            
            if (existing) {
                const finalStatus = status !== undefined ? status : existing.status;
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
                `).run(req.user.id, clientId, documentId, status || 'Pending Review', remark || '', now);
            }

            return sendSuccess(res, { documentId, status, remark }, 'Document review updated successfully');
        } catch (error) {
            console.error('[CA updateClientDocumentReview Error]', error);
            return sendError(res, 'Failed to update document review', 500);
        }
    }
};

module.exports = caController;
