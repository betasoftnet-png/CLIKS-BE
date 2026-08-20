const db = require('../db/connection');
let tableEnsured = false;

/**
 * Customer Connection Service - CLIKS Business <-> CLIKS Website Connection System
 */
const connectionService = {
    /**
     * Self-healing table check
     */
    ensureTable: async () => {
        if (tableEnsured) return;
        try {
            await db.prepare(`
                CREATE TABLE IF NOT EXISTS customer_connections (
                    id INTEGER PRIMARY KEY,
                    business_id INTEGER NOT NULL,
                    business_customer_id INTEGER NOT NULL,
                    website_user_id INTEGER,
                    customer_email TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    requested_at TEXT,
                    responded_at TEXT,
                    created_at TEXT,
                    updated_at TEXT
                )
            `).run();
            tableEnsured = true;
        } catch (e) {}
    },

    /**
     * Called when a Business creates or updates a customer in CLIKS Business.
     * Matches customer email against CLIKS Website users table.
     * If a website user exists, creates or maintains a connection request (pending/accepted/rejected).
     */
    syncCustomerConnectionOnCreateOrUpdate: async ({ business_id, business_customer_id, customer_email }) => {
        await connectionService.ensureTable();
        if (!business_id || !business_customer_id || !customer_email) return null;

        const emailLower = String(customer_email).trim().toLowerCase();
        if (!emailLower) return null;

        const now = new Date().toISOString();

        // 1. Search users table for matching CLIKS Website user
        const websiteUser = await db.prepare('SELECT id, email, role FROM users WHERE LOWER(email) = ?').get(emailLower);

        // 2. Check if a connection record already exists for this business + customer
        let existing = await db.prepare(`
            SELECT * FROM customer_connections 
            WHERE business_id = ? AND (business_customer_id = ? OR LOWER(customer_email) = ?)
        `).get(business_id, business_customer_id, emailLower);

        if (websiteUser) {
            if (!existing) {
                // Create new PENDING connection request
                const res = await db.prepare(`
                    INSERT INTO customer_connections (
                        business_id, business_customer_id, website_user_id, customer_email,
                        status, requested_at, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
                `).run(business_id, business_customer_id, websiteUser.id, emailLower, now, now, now);

                existing = await db.prepare('SELECT * FROM customer_connections WHERE id = ?').get(res.lastInsertRowid);
            } else {
                // Update website_user_id if missing
                await db.prepare(`
                    UPDATE customer_connections 
                    SET website_user_id = ?, business_customer_id = ?, customer_email = ?, updated_at = ?
                    WHERE id = ?
                `).run(websiteUser.id, business_customer_id, emailLower, now, existing.id);
            }
        }
        return existing;
    },

    /**
     * Get connection status for a customer in CLIKS Business:
     * Returns 'CONNECTED', 'PENDING', or 'UNCONNECTED'.
     */
    getCustomerConnectionStatus: async (business_id, business_customer_id, customer_email) => {
        await connectionService.ensureTable();

        const emailLower = customer_email ? String(customer_email).trim().toLowerCase() : '';

        let conn = await db.prepare(`
            SELECT * FROM customer_connections 
            WHERE business_id = ? AND (business_customer_id = ? ${emailLower ? 'OR LOWER(customer_email) = ?' : ''})
        `).get(...(emailLower ? [business_id, business_customer_id, emailLower] : [business_id, business_customer_id]));

        if (conn) {
            const st = String(conn.status).toLowerCase();
            if (st === 'accepted' || st === 'connected') return 'CONNECTED';
            if (st === 'pending') return 'PENDING';
            if (st === 'rejected') return 'UNCONNECTED';
        }

        // If no connection record exists, check if email matches a website user
        if (emailLower) {
            const websiteUser = await db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(emailLower);
            if (websiteUser) {
                // Auto-create pending connection request so the user can accept/reject in Website
                const now = new Date().toISOString();
                try {
                    await db.prepare(`
                        INSERT INTO customer_connections (
                            business_id, business_customer_id, website_user_id, customer_email,
                            status, requested_at, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
                    `).run(business_id, business_customer_id, websiteUser.id, emailLower, now, now, now);
                } catch (e) {}
                return 'PENDING';
            }
        }

        return 'UNCONNECTED';
    },

    /**
     * Get all active integration connection requests for a CLIKS Website user
     */
    getWebsiteUserIntegrations: async (website_user_id, website_user_email) => {
        await connectionService.ensureTable();

        const emailLower = website_user_email ? String(website_user_email).trim().toLowerCase() : '';

        // Auto-link any existing business_customers whose email matches emailLower but don't have a connection row yet
        if (emailLower) {
            const matchingCustomers = await db.prepare(`
                SELECT id, user_id, name, email, created_at FROM business_customers 
                WHERE LOWER(email) = ?
            `).all(emailLower);

            const now = new Date().toISOString();
            for (const cust of (matchingCustomers || [])) {
                const connExists = await db.prepare(`
                    SELECT id FROM customer_connections 
                    WHERE business_id = ? AND (business_customer_id = ? OR LOWER(customer_email) = ?)
                `).get(cust.user_id, cust.id, emailLower);

                if (!connExists) {
                    try {
                        await db.prepare(`
                            INSERT INTO customer_connections (
                                business_id, business_customer_id, website_user_id, customer_email,
                                status, requested_at, created_at, updated_at
                            ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
                        `).run(cust.user_id, cust.id, website_user_id, emailLower, cust.created_at || now, now, now);
                    } catch (e) {}
                }
            }
        }

        // Fetch connection rows
        const connections = await db.prepare(`
            SELECT * FROM customer_connections 
            WHERE website_user_id = ? ${emailLower ? 'OR LOWER(customer_email) = ?' : ''}
            ORDER BY id DESC
        `).all(...(emailLower ? [website_user_id, emailLower] : [website_user_id]));

        const results = [];
        for (const conn of (connections || [])) {
            // Get business (merchant) name from users table
            const merchant = await db.prepare('SELECT id, username, business_name, email FROM users WHERE id = ?').get(conn.business_id);
            const businessName = merchant ? (merchant.business_name || merchant.username || 'CLIKS Merchant Store') : 'CLIKS Business Partner';

            // Get customer name from business_customers table
            const bCustomer = await db.prepare('SELECT id, name, email FROM business_customers WHERE id = ?').get(conn.business_customer_id);
            const customerName = bCustomer ? bCustomer.name : 'Customer';

            const st = String(conn.status).toLowerCase();
            let mappedStatus = 'PENDING';
            if (st === 'accepted' || st === 'connected') mappedStatus = 'CONNECTED';
            else if (st === 'rejected') mappedStatus = 'UNCONNECTED';
            else mappedStatus = 'PENDING';

            results.push({
                id: conn.id,
                business_id: conn.business_id,
                business_customer_id: conn.business_customer_id,
                website_user_id: conn.website_user_id,
                business_name: businessName,
                customer_name: customerName,
                customer_email: conn.customer_email,
                status: mappedStatus,
                raw_status: conn.status,
                requested_at: conn.requested_at || conn.created_at,
                responded_at: conn.responded_at
            });
        }

        return results;
    },

    /**
     * Customer responds to a connection request (Accept or Reject)
     * Security check: ensure user owns the connection request!
     */
    respondToIntegrationRequest: async ({ website_user_id, website_user_email, connection_id, action }) => {
        await connectionService.ensureTable();

        const emailLower = website_user_email ? String(website_user_email).trim().toLowerCase() : '';

        const conn = await db.prepare('SELECT * FROM customer_connections WHERE id = ?').get(connection_id);
        if (!conn) {
            throw new Error('Connection request not found');
        }

        // Security check
        const isOwner = (conn.website_user_id === website_user_id) ||
            (conn.customer_email && conn.customer_email.toLowerCase() === emailLower);

        if (!isOwner) {
            const err = new Error('Unauthorized: This connection request does not belong to your account');
            err.statusCode = 403;
            throw err;
        }

        const act = String(action).toLowerCase();
        let newStatus = 'pending';
        if (act === 'accept' || act === 'accepted') {
            newStatus = 'accepted';
        } else if (act === 'reject' || act === 'rejected') {
            newStatus = 'rejected';
        } else {
            throw new Error('Invalid action. Must be accept or reject');
        }

        const now = new Date().toISOString();
        await db.prepare(`
            UPDATE customer_connections 
            SET status = ?, website_user_id = ?, responded_at = ?, updated_at = ?
            WHERE id = ?
        `).run(newStatus, website_user_id, now, now, connection_id);

        const updated = await db.prepare('SELECT * FROM customer_connections WHERE id = ?').get(connection_id);

        try {
            const b2bConnectionService = require('./b2bConnectionService');
            const custEmailLower = (conn.customer_email || '').toLowerCase();
            const b2bConn = await db.prepare(`
                SELECT id FROM b2b_connections
                WHERE (requester_user_id = ? AND (target_user_id = ? OR LOWER(target_email) = ?))
                   OR (target_user_id = ? AND (requester_user_id = ? OR LOWER(requester_email) = ?))
            `).get(conn.business_id, website_user_id, custEmailLower, website_user_id, conn.business_id, custEmailLower);

            if (b2bConn) {
                await b2bConnectionService.respondToConnection({
                    user_id: website_user_id,
                    connection_id: b2bConn.id,
                    action
                });
            }
        } catch (b2bErr) {
            console.warn('[connectionService] B2B respond sync warning:', b2bErr.message);
        }

        if (newStatus === 'accepted') {
            try {
                const { syncConnectedCustomerPurchases } = require('./customerIntegration');
                await syncConnectedCustomerPurchases(website_user_id, website_user_email);
            } catch (syncErr) {
                console.warn('[connectionService] Auto-sync after connection accept warning:', syncErr.message);
            }
        }

        return updated;
    }
};

module.exports = connectionService;
