const db = require('../db/connection');
let tableEnsured = false;

/**
 * Supplier Connection & Portal Service - CLIKS Business <-> CLIKS Website Connection System for Suppliers
 */
const supplierConnectionService = {
    /**
     * Self-healing table & schema check for Supplier workflow
     */
    ensureTable: async () => {
        if (tableEnsured) return;
        
        // 1. Supplier Connections table
        try {
            await db.prepare(`
                CREATE TABLE IF NOT EXISTS supplier_connections (
                    id INTEGER PRIMARY KEY,
                    business_id INTEGER NOT NULL,
                    supplier_id INTEGER NOT NULL,
                    supplier_user_id INTEGER,
                    supplier_email TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    requested_at TEXT,
                    responded_at TEXT,
                    created_at TEXT,
                    updated_at TEXT
                )
            `).run();
        } catch (e) {
            console.warn('[Supplier Connection Service] supplier_connections table creation:', e.message);
        }

        // 2. Dealer <-> Supplier Chat table
        try {
            await db.prepare(`
                CREATE TABLE IF NOT EXISTS supplier_chats (
                    id INTEGER PRIMARY KEY,
                    purchase_id INTEGER,
                    supplier_id INTEGER NOT NULL,
                    business_id INTEGER NOT NULL,
                    sender_type TEXT NOT NULL,
                    sender_id INTEGER NOT NULL,
                    sender_name TEXT,
                    message TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
            `).run();
        } catch (e) {
            console.warn('[Supplier Connection Service] supplier_chats table creation:', e.message);
        }

        // 3. Ensure business_suppliers table exists
        try {
            await db.prepare(`
                CREATE TABLE IF NOT EXISTS business_suppliers (
                    id INTEGER PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    email TEXT,
                    phone TEXT,
                    company TEXT,
                    gstin TEXT,
                    status TEXT DEFAULT 'PENDING',
                    city TEXT,
                    outstanding_balance REAL DEFAULT 0,
                    total_purchased REAL DEFAULT 0,
                    created_at TEXT,
                    updated_at TEXT
                )
            `).run();
        } catch(e) {}

        try { await db.prepare("ALTER TABLE business_suppliers ADD COLUMN status TEXT DEFAULT 'PENDING'").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE business_suppliers ADD COLUMN bank_account_number TEXT").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE business_suppliers ADD COLUMN ifsc_code TEXT").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE business_suppliers ADD COLUMN upi_id TEXT").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE business_suppliers ADD COLUMN documents TEXT").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE business_suppliers ADD COLUMN reminder_schedule TEXT").run(); } catch(e) {}

        // 4. Ensure business_purchases has supplier confirmation fields
        try { await db.prepare("ALTER TABLE business_purchases ADD COLUMN supplier_confirmation_status TEXT DEFAULT 'PENDING'").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE business_purchases ADD COLUMN confirmed_at TEXT").run(); } catch(e) {}

        // 5. Ensure sub-resource tables exist
        try {
            await db.prepare(`
                CREATE TABLE IF NOT EXISTS supplier_ledger (
                    id INTEGER PRIMARY KEY,
                    supplier_id INTEGER NOT NULL,
                    user_id INTEGER NOT NULL,
                    description TEXT,
                    amount REAL DEFAULT 0,
                    type TEXT,
                    created_at TEXT
                )
            `).run();
        } catch(e) {}

        try {
            await db.prepare(`
                CREATE TABLE IF NOT EXISTS supplier_payments (
                    id INTEGER PRIMARY KEY,
                    supplier_id INTEGER NOT NULL,
                    user_id INTEGER NOT NULL,
                    amount REAL DEFAULT 0,
                    payment_method TEXT,
                    reference_number TEXT,
                    created_at TEXT
                )
            `).run();
        } catch(e) {}

        try {
            await db.prepare(`
                CREATE TABLE IF NOT EXISTS supplier_addresses (
                    id INTEGER PRIMARY KEY,
                    supplier_id INTEGER NOT NULL,
                    user_id INTEGER NOT NULL,
                    address_line1 TEXT,
                    address_line2 TEXT,
                    city TEXT,
                    state TEXT,
                    postal_code TEXT,
                    country TEXT DEFAULT 'India',
                    created_at TEXT
                )
            `).run();
        } catch(e) {}

        try {
            await db.prepare(`
                CREATE TABLE IF NOT EXISTS supplier_contacts (
                    id INTEGER PRIMARY KEY,
                    supplier_id INTEGER NOT NULL,
                    user_id INTEGER NOT NULL,
                    contact_name TEXT,
                    email TEXT,
                    phone TEXT,
                    designation TEXT,
                    created_at TEXT
                )
            `).run();
        } catch(e) {}

        try {
            await db.prepare(`
                CREATE TABLE IF NOT EXISTS supplier_notes (
                    id INTEGER PRIMARY KEY,
                    supplier_id INTEGER NOT NULL,
                    user_id INTEGER NOT NULL,
                    note TEXT,
                    created_at TEXT
                )
            `).run();
        } catch(e) {}

        try {
            await db.prepare(`
                CREATE TABLE IF NOT EXISTS supplier_documents (
                    id INTEGER PRIMARY KEY,
                    supplier_id INTEGER NOT NULL,
                    user_id INTEGER NOT NULL,
                    file_name TEXT,
                    file_url TEXT,
                    file_size TEXT,
                    created_at TEXT
                )
            `).run();
        } catch(e) {}

        tableEnsured = true;
    },

    /**
     * Called when a Dealer adds or updates a Supplier in CLIKS Business.
     * Matches supplier email/username/phone against CLIKS Website users table.
     * Creates or maintains a persistent connection request with PENDING status.
     */
    syncSupplierConnectionOnCreateOrUpdate: async ({ business_id, supplier_id, supplier_email, phone }) => {
        await supplierConnectionService.ensureTable();
        if (!business_id || !supplier_id) return null;

        const emailLower = supplier_email ? String(supplier_email).trim().toLowerCase() : '';
        const phoneClean = phone ? String(phone).replace(/\D/g, '') : '';
        const usernamePrefix = emailLower.includes('@') ? emailLower.split('@')[0] : emailLower;
        const now = new Date().toISOString();

        // Ensure business_suppliers status is PENDING initially if not explicitly ACCEPTED/CONNECTED/REJECTED
        const currentSup = await db.prepare('SELECT * FROM business_suppliers WHERE id = ?').get(supplier_id);
        if (currentSup && (!currentSup.status || currentSup.status.toLowerCase() === 'active' || currentSup.status.toLowerCase() === 'pending')) {
            await db.prepare("UPDATE business_suppliers SET status = 'PENDING', updated_at = ? WHERE id = ?").run(now, supplier_id);
        }

        // Search users table for matching CLIKS Website user by email, username, or phone
        let websiteUser = null;
        if (emailLower) {
            websiteUser = await db.prepare(`
                SELECT id, email, username FROM users 
                WHERE LOWER(email) = ? OR LOWER(username) = ? OR LOWER(username) = ?
            `).get(emailLower, emailLower, usernamePrefix);
        }
        if (!websiteUser && phoneClean) {
            try {
                websiteUser = await db.prepare(`
                    SELECT id, email, username, role FROM users 
                    WHERE phone = ? OR phone LIKE ?
                `).get(phoneClean, `%${phoneClean}%`);
            } catch (e) {
                // Ignore if phone column does not exist on users table
            }
        }

        // Check if a connection record already exists for this business_id + supplier_id
        let existing = await db.prepare(`
            SELECT * FROM supplier_connections 
            WHERE business_id = ? AND supplier_id = ?
        `).get(business_id, supplier_id);

        if (!existing && emailLower) {
            existing = await db.prepare(`
                SELECT * FROM supplier_connections 
                WHERE business_id = ? AND (LOWER(supplier_email) = ? OR LOWER(supplier_email) = ?) AND (supplier_id IS NULL OR supplier_id = 0)
            `).get(business_id, emailLower, usernamePrefix);
        }

        if (!existing) {
            // Create new PENDING connection request
            const res = await db.prepare(`
                INSERT INTO supplier_connections (
                    business_id, supplier_id, supplier_user_id, supplier_email,
                    status, requested_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
            `).run(business_id, supplier_id, websiteUser ? websiteUser.id : null, emailLower || `${supplier_id}@supplier.cliks`, now, now, now);

            existing = await db.prepare('SELECT * FROM supplier_connections WHERE id = ?').get(res.lastInsertRowid);
        } else {
            await db.prepare(`
                UPDATE supplier_connections 
                SET supplier_user_id = ?, supplier_id = ?, supplier_email = ?, updated_at = ?
                WHERE id = ?
            `).run(websiteUser ? websiteUser.id : existing.supplier_user_id, supplier_id, emailLower || existing.supplier_email, now, existing.id);
        }

        return existing;
    },

    /**
     * Get connection status for a Supplier in CLIKS Business.
     * Returns 'CONNECTED', 'PENDING', or 'REJECTED'.
     */
    getSupplierConnectionStatus: async (business_id, supplier_id, supplier_email) => {
        await supplierConnectionService.ensureTable();

        const emailLower = supplier_email ? String(supplier_email).trim().toLowerCase() : '';
        const usernamePrefix = emailLower.includes('@') ? emailLower.split('@')[0] : emailLower;

        let conn = await db.prepare(`
            SELECT * FROM supplier_connections 
            WHERE business_id = ? AND supplier_id = ?
        `).get(business_id, supplier_id);

        if (!conn && emailLower) {
            conn = await db.prepare(`
                SELECT * FROM supplier_connections 
                WHERE business_id = ? AND (LOWER(supplier_email) = ? OR LOWER(supplier_email) = ?)
            `).get(business_id, emailLower, usernamePrefix);
        }

        if (conn) {
            const st = String(conn.status).toLowerCase();
            if (st === 'accepted' || st === 'connected') return 'CONNECTED';
            if (st === 'rejected') return 'REJECTED';
            if (st === 'pending') return 'PENDING';
        }

        // Fallback: check business_suppliers table status column directly
        const sup = await db.prepare('SELECT status FROM business_suppliers WHERE id = ?').get(supplier_id);
        if (sup && sup.status) {
            const st = String(sup.status).toUpperCase();
            if (st === 'ACCEPTED' || st === 'CONNECTED') return 'CONNECTED';
            if (st === 'REJECTED' || st === 'UNCONNECTED') return 'REJECTED';
            if (st === 'PENDING') return 'PENDING';
        }

        return 'PENDING';
    },

    /**
     * Get all active supplier connection requests for a CLIKS Website user
     */
    getWebsiteSupplierIntegrations: async (website_user_id, website_user_email) => {
        await supplierConnectionService.ensureTable();

        let userEmail = website_user_email ? String(website_user_email).trim().toLowerCase() : '';
        let userName = '';
        let userPhone = '';

        // Resolve user identity details from DB
        if (website_user_id) {
            try {
                const u = await db.prepare('SELECT id, email, username FROM users WHERE id = ?').get(website_user_id);
                if (u) {
                    if (u.email && !userEmail) userEmail = String(u.email).trim().toLowerCase();
                    if (u.username) userName = String(u.username).trim().toLowerCase();
                }
            } catch(e) {}
        }

        const usernamePrefix = userEmail.includes('@') ? userEmail.split('@')[0] : (userName.includes('@') ? userName.split('@')[0] : userName);

        // Auto-link any existing business_suppliers matching userEmail, userName, or userPhone
        if (userEmail || userName || userPhone) {
            const queryParams = [userEmail || '___none___', userName || '___none___'];
            let sqlFilter = `WHERE (LOWER(TRIM(email)) = ? OR LOWER(TRIM(email)) = ?`;

            if (usernamePrefix) {
                sqlFilter += ` OR LOWER(TRIM(email)) LIKE ?`;
                queryParams.push(`${usernamePrefix}@%`);
            }
            if (userPhone) {
                sqlFilter += ` OR phone = ? OR phone LIKE ?`;
                queryParams.push(userPhone, `%${userPhone}%`);
            }
            sqlFilter += `)`;

            const matchingSuppliers = await db.prepare(`
                SELECT id, user_id, name, email, phone, created_at FROM business_suppliers 
                ${sqlFilter}
            `).all(...queryParams);

            const now = new Date().toISOString();
            for (const sup of (matchingSuppliers || [])) {
                const connExists = await db.prepare(`
                    SELECT id, supplier_user_id FROM supplier_connections 
                    WHERE business_id = ? AND supplier_id = ?
                `).get(sup.user_id, sup.id);

                if (!connExists) {
                    try {
                        await db.prepare(`
                            INSERT INTO supplier_connections (
                                business_id, supplier_id, supplier_user_id, supplier_email,
                                status, requested_at, created_at, updated_at
                            ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
                        `).run(sup.user_id, sup.id, website_user_id, sup.email || userEmail, sup.created_at || now, now, now);
                    } catch (e) {}
                } else if (website_user_id && !connExists.supplier_user_id) {
                    try {
                        await db.prepare(`
                            UPDATE supplier_connections 
                            SET supplier_user_id = ?, supplier_email = ?, updated_at = ?
                            WHERE id = ?
                        `).run(website_user_id, sup.email || userEmail, now, connExists.id);
                    } catch (e) {}
                }
            }
        }

        // Fetch supplier connection requests
        const connParams = [website_user_id];
        let connFilter = `WHERE supplier_user_id = ?`;

        if (userEmail) {
            connFilter += ` OR LOWER(TRIM(supplier_email)) = ?`;
            connParams.push(userEmail);
        }
        if (userName) {
            connFilter += ` OR LOWER(TRIM(supplier_email)) = ?`;
            connParams.push(userName);
        }
        if (usernamePrefix) {
            connFilter += ` OR LOWER(TRIM(supplier_email)) LIKE ?`;
            connParams.push(`${usernamePrefix}@%`);
        }

        const connections = await db.prepare(`
            SELECT * FROM supplier_connections 
            ${connFilter}
            ORDER BY id DESC
        `).all(...connParams);

        const results = [];
        const seenConnIds = new Set();

        for (const conn of (connections || [])) {
            if (seenConnIds.has(conn.id)) continue;
            seenConnIds.add(conn.id);

            const merchant = await db.prepare('SELECT id, username, business_name, email FROM users WHERE id = ?').get(conn.business_id);
            const businessName = merchant ? (merchant.business_name || merchant.username || 'CLIKS Dealer Store') : 'CLIKS Business Partner';

            const bSupplier = await db.prepare('SELECT id, name, email, phone, company, gstin FROM business_suppliers WHERE id = ?').get(conn.supplier_id);
            const supplierName = bSupplier ? bSupplier.name : 'Supplier';

            const st = String(conn.status).toLowerCase();
            let mappedStatus = 'PENDING';
            if (st === 'accepted' || st === 'connected') mappedStatus = 'CONNECTED';
            else if (st === 'rejected' || st === 'unconnected') mappedStatus = 'REJECTED';
            else mappedStatus = 'PENDING';

            results.push({
                id: conn.id,
                business_id: conn.business_id,
                supplier_id: conn.supplier_id,
                supplier_user_id: conn.supplier_user_id,
                dealer_business_name: businessName,
                dealer_name: merchant ? (merchant.username || businessName) : 'CLIKS Dealer',
                dealer_email: merchant ? merchant.email : '',
                supplier_name: supplierName,
                supplier_email: conn.supplier_email,
                phone: bSupplier ? bSupplier.phone : '',
                gstin: bSupplier ? bSupplier.gstin : '',
                company: bSupplier ? bSupplier.company : '',
                status: mappedStatus,
                connection_status: mappedStatus,
                raw_status: conn.status,
                requested_at: conn.requested_at || conn.created_at,
                responded_at: conn.responded_at,
                created_at: conn.created_at
            });
        }

        return results;
    },

    /**
     * Supplier responds to a connection request (Accept or Reject)
     */
    respondToSupplierIntegrationRequest: async ({ website_user_id, website_user_email, connection_id, action }) => {
        await supplierConnectionService.ensureTable();

        const conn = await db.prepare('SELECT * FROM supplier_connections WHERE id = ?').get(connection_id);
        if (!conn) {
            throw new Error('Supplier connection request not found');
        }

        const act = String(action).toLowerCase();
        let newStatus = 'pending';
        let mainStatus = 'PENDING';

        if (act === 'accept' || act === 'accepted') {
            newStatus = 'accepted';
            mainStatus = 'CONNECTED';
        } else if (act === 'reject' || act === 'rejected') {
            newStatus = 'rejected';
            mainStatus = 'REJECTED';
        } else {
            throw new Error('Invalid action. Must be accept or reject');
        }

        const now = new Date().toISOString();
        await db.prepare(`
            UPDATE supplier_connections 
            SET status = ?, supplier_user_id = ?, responded_at = ?, updated_at = ?
            WHERE id = ?
        `).run(newStatus, website_user_id, now, now, connection_id);

        // Update business_suppliers table status
        await db.prepare(`
            UPDATE business_suppliers 
            SET status = ?, updated_at = ?
            WHERE id = ?
        `).run(mainStatus, now, conn.supplier_id);

        // Also trigger B2B connection response to create business_customers row for target user
        try {
            const b2bConnectionService = require('./b2bConnectionService');
            const supEmailLower = (conn.supplier_email || '').toLowerCase();
            const b2bConn = await db.prepare(`
                SELECT id FROM b2b_connections
                WHERE (requester_user_id = ? AND (target_user_id = ? OR LOWER(target_email) = ?))
                   OR (target_user_id = ? AND (requester_user_id = ? OR LOWER(requester_email) = ?))
            `).get(conn.business_id, website_user_id, supEmailLower, website_user_id, conn.business_id, supEmailLower);

            if (b2bConn) {
                await b2bConnectionService.respondToConnection({
                    user_id: website_user_id,
                    connection_id: b2bConn.id,
                    action
                });
            }
        } catch (b2bErr) {
            console.warn('[SupplierConnectionService] B2B respond sync warning:', b2bErr.message);
        }

        const updated = await db.prepare('SELECT * FROM supplier_connections WHERE id = ?').get(connection_id);
        return { ...updated, status: mainStatus, connection_status: mainStatus };
    },

    /**
     * Dealer <-> Supplier Chat: Fetch Messages
     */
    getSupplierChats: async ({ business_id, supplier_id, purchase_id }) => {
        await supplierConnectionService.ensureTable();

        let sql = `SELECT * FROM supplier_chats WHERE supplier_id = ?`;
        const params = [supplier_id];

        if (business_id) {
            sql += ` AND business_id = ?`;
            params.push(business_id);
        }

        if (purchase_id) {
            sql += ` AND (purchase_id = ? OR purchase_id IS NULL)`;
            params.push(purchase_id);
        }

        sql += ` ORDER BY id ASC`;
        return await db.prepare(sql).all(...params);
    },

    /**
     * Dealer <-> Supplier Chat: Send Message
     */
    sendSupplierChatMessage: async ({ business_id, supplier_id, purchase_id, sender_type, sender_id, sender_name, message }) => {
        await supplierConnectionService.ensureTable();

        if (!message || !message.trim()) {
            throw new Error('Message content cannot be empty');
        }

        let targetBusinessId = business_id;
        if (!targetBusinessId && supplier_id) {
            const bSup = await db.prepare('SELECT user_id FROM business_suppliers WHERE id = ?').get(supplier_id);
            if (bSup) targetBusinessId = bSup.user_id;
        }

        const now = new Date().toISOString();
        const res = await db.prepare(`
            INSERT INTO supplier_chats (
                purchase_id, supplier_id, business_id, sender_type, sender_id, sender_name, message, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(purchase_id || null, supplier_id, targetBusinessId || 0, sender_type || 'supplier', sender_id, sender_name || 'User', message.trim(), now);

        return await db.prepare('SELECT * FROM supplier_chats WHERE id = ?').get(res.lastInsertRowid);
    }
};

module.exports = supplierConnectionService;
