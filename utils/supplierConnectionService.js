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

        // 4. Ensure business_purchases has supplier confirmation fields
        try { await db.prepare("ALTER TABLE business_purchases ADD COLUMN supplier_confirmation_status TEXT DEFAULT 'PENDING'").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE business_purchases ADD COLUMN confirmed_at TEXT").run(); } catch(e) {}

        // 5. Ensure business_purchase_items has item_status and unit fields
        try { await db.prepare("ALTER TABLE business_purchase_items ADD COLUMN item_status TEXT DEFAULT 'CONFIRMED'").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE business_purchase_items ADD COLUMN unit TEXT DEFAULT 'PCS'").run(); } catch(e) {}

        tableEnsured = true;
    },

    /**
     * Called when a Dealer adds or updates a Supplier in CLIKS Business.
     * Matches supplier email against CLIKS Website users table.
     * If a website user exists or on creation, creates or maintains a connection request with PENDING status.
     */
    syncSupplierConnectionOnCreateOrUpdate: async ({ business_id, supplier_id, supplier_email }) => {
        await supplierConnectionService.ensureTable();
        if (!business_id || !supplier_id) return null;

        const emailLower = supplier_email ? String(supplier_email).trim().toLowerCase() : '';
        const now = new Date().toISOString();

        // Ensure business_suppliers status is PENDING initially if not explicitly ACCEPTED/CONNECTED
        const currentSup = await db.prepare('SELECT * FROM business_suppliers WHERE id = ?').get(supplier_id);
        if (currentSup && (!currentSup.status || currentSup.status.toLowerCase() === 'active' || currentSup.status.toLowerCase() === 'pending')) {
            await db.prepare("UPDATE business_suppliers SET status = 'PENDING', updated_at = ? WHERE id = ?").run(now, supplier_id);
        }

        if (!emailLower) return null;

        // Search users table for matching CLIKS Website user
        const websiteUser = await db.prepare('SELECT id, email, role FROM users WHERE LOWER(email) = ?').get(emailLower);

        // Check if a connection record already exists
        let existing = await db.prepare(`
            SELECT * FROM supplier_connections 
            WHERE business_id = ? AND (supplier_id = ? OR LOWER(supplier_email) = ?)
        `).get(business_id, supplier_id, emailLower);

        if (!existing) {
            // Create new PENDING connection request
            const res = await db.prepare(`
                INSERT INTO supplier_connections (
                    business_id, supplier_id, supplier_user_id, supplier_email,
                    status, requested_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
            `).run(business_id, supplier_id, websiteUser ? websiteUser.id : null, emailLower, now, now, now);

            existing = await db.prepare('SELECT * FROM supplier_connections WHERE id = ?').get(res.lastInsertRowid);
        } else if (websiteUser && !existing.supplier_user_id) {
            await db.prepare(`
                UPDATE supplier_connections 
                SET supplier_user_id = ?, supplier_id = ?, supplier_email = ?, updated_at = ?
                WHERE id = ?
            `).run(websiteUser.id, supplier_id, emailLower, now, existing.id);
        }

        return existing;
    },

    /**
     * Get connection status for a Supplier in CLIKS Business.
     * Returns 'CONNECTED', 'PENDING', or 'UNCONNECTED'.
     */
    getSupplierConnectionStatus: async (business_id, supplier_id, supplier_email) => {
        await supplierConnectionService.ensureTable();

        const emailLower = supplier_email ? String(supplier_email).trim().toLowerCase() : '';

        let conn = await db.prepare(`
            SELECT * FROM supplier_connections 
            WHERE business_id = ? AND (supplier_id = ? ${emailLower ? 'OR LOWER(supplier_email) = ?' : ''})
        `).get(...(emailLower ? [business_id, supplier_id, emailLower] : [business_id, supplier_id]));

        if (conn) {
            const st = String(conn.status).toLowerCase();
            if (st === 'accepted' || st === 'connected') return 'CONNECTED';
            if (st === 'pending') return 'PENDING';
            if (st === 'rejected') return 'UNCONNECTED';
        }

        // Fallback: check business_suppliers table status column directly
        const sup = await db.prepare('SELECT status FROM business_suppliers WHERE id = ?').get(supplier_id);
        if (sup && sup.status) {
            const st = String(sup.status).toUpperCase();
            if (st === 'ACCEPTED' || st === 'CONNECTED') return 'CONNECTED';
            if (st === 'PENDING') return 'PENDING';
            if (st === 'REJECTED' || st === 'UNCONNECTED') return 'UNCONNECTED';
        }

        return 'PENDING';
    },

    /**
     * Get all active supplier connection requests for a CLIKS Website user
     */
    getWebsiteSupplierIntegrations: async (website_user_id, website_user_email) => {
        await supplierConnectionService.ensureTable();

        const emailLower = website_user_email ? String(website_user_email).trim().toLowerCase() : '';

        // Auto-link any existing business_suppliers matching emailLower
        if (emailLower) {
            const matchingSuppliers = await db.prepare(`
                SELECT id, user_id, name, email, created_at FROM business_suppliers 
                WHERE LOWER(email) = ?
            `).all(emailLower);

            const now = new Date().toISOString();
            for (const sup of (matchingSuppliers || [])) {
                const connExists = await db.prepare(`
                    SELECT id FROM supplier_connections 
                    WHERE business_id = ? AND (supplier_id = ? OR LOWER(supplier_email) = ?)
                `).get(sup.user_id, sup.id, emailLower);

                if (!connExists) {
                    try {
                        await db.prepare(`
                            INSERT INTO supplier_connections (
                                business_id, supplier_id, supplier_user_id, supplier_email,
                                status, requested_at, created_at, updated_at
                            ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
                        `).run(sup.user_id, sup.id, website_user_id, emailLower, sup.created_at || now, now, now);
                    } catch (e) {}
                }
            }
        }

        const connections = await db.prepare(`
            SELECT * FROM supplier_connections 
            WHERE supplier_user_id = ? ${emailLower ? 'OR LOWER(supplier_email) = ?' : ''}
            ORDER BY id DESC
        `).all(...(emailLower ? [website_user_id, emailLower] : [website_user_id]));

        const results = [];
        for (const conn of (connections || [])) {
            const merchant = await db.prepare('SELECT id, username, business_name, email FROM users WHERE id = ?').get(conn.business_id);
            const businessName = merchant ? (merchant.business_name || merchant.username || 'CLIKS Dealer Store') : 'CLIKS Business Partner';

            const bSupplier = await db.prepare('SELECT id, name, email, company FROM business_suppliers WHERE id = ?').get(conn.supplier_id);
            const supplierName = bSupplier ? bSupplier.name : 'Supplier';

            const st = String(conn.status).toLowerCase();
            let mappedStatus = 'PENDING';
            if (st === 'accepted' || st === 'connected') mappedStatus = 'CONNECTED';
            else if (st === 'rejected') mappedStatus = 'UNCONNECTED';
            else mappedStatus = 'PENDING';

            results.push({
                id: conn.id,
                business_id: conn.business_id,
                supplier_id: conn.supplier_id,
                supplier_user_id: conn.supplier_user_id,
                dealer_business_name: businessName,
                supplier_name: supplierName,
                supplier_email: conn.supplier_email,
                status: mappedStatus,
                raw_status: conn.status,
                requested_at: conn.requested_at || conn.created_at,
                responded_at: conn.responded_at
            });
        }

        return results;
    },

    /**
     * Supplier responds to a connection request (Accept or Reject)
     */
    respondToSupplierIntegrationRequest: async ({ website_user_id, website_user_email, connection_id, action }) => {
        await supplierConnectionService.ensureTable();

        const emailLower = website_user_email ? String(website_user_email).trim().toLowerCase() : '';

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
            mainStatus = 'UNCONNECTED';
        } else {
            throw new Error('Invalid action. Must be accept or reject');
        }

        const now = new Date().toISOString();
        await db.prepare(`
            UPDATE supplier_connections 
            SET status = ?, supplier_user_id = ?, responded_at = ?, updated_at = ?
            WHERE id = ?
        `).run(newStatus, website_user_id, now, now, connection_id);

        // Update business_suppliers table
        await db.prepare(`
            UPDATE business_suppliers 
            SET status = ?, updated_at = ?
            WHERE id = ?
        `).run(mainStatus, now, conn.supplier_id);

        const updated = await db.prepare('SELECT * FROM supplier_connections WHERE id = ?').get(connection_id);
        return { ...updated, main_status: mainStatus };
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
