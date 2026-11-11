const db = require('../db/connection');

let tableEnsured = false;

const b2bConnectionService = {
    ensureTable: async () => {
        if (tableEnsured) return;
        try {
            const isPg = process.env.DB_TYPE === 'postgres';
            const autoId = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';

            await db.prepare(`
                CREATE TABLE IF NOT EXISTS b2b_connections (
                    id ${autoId},
                    requester_user_id INTEGER NOT NULL,
                    requester_email TEXT NOT NULL,
                    requester_business_name TEXT,
                    target_user_id INTEGER NOT NULL,
                    target_email TEXT NOT NULL,
                    target_business_name TEXT,
                    connection_type TEXT DEFAULT 'Supplier Connection Request',
                    status TEXT NOT NULL DEFAULT 'PENDING',
                    created_at TEXT,
                    accepted_at TEXT,
                    updated_at TEXT
                )
            `).run();

            await db.prepare(`
                CREATE TABLE IF NOT EXISTS b2b_invoice_relationships (
                    id ${autoId},
                    source_purchase_invoice_id INTEGER NOT NULL,
                    generated_sales_invoice_id INTEGER NOT NULL,
                    buyer_user_id INTEGER NOT NULL,
                    buyer_email TEXT,
                    supplier_user_id INTEGER NOT NULL,
                    supplier_email TEXT,
                    connection_id INTEGER,
                    connection_transaction_id TEXT NOT NULL UNIQUE,
                    created_at TEXT
                )
            `).run();

            try {
                await db.prepare('ALTER TABLE business_invoices ADD COLUMN notes TEXT').run();
            } catch (e) {}

            tableEnsured = true;
        } catch (e) {
            console.error('[B2B Connection Service] ensureTable error:', e);
        }
    },

    // Create or update B2B Connection when a supplier is added/updated by a user
    createOrUpdateConnection: async ({ requester_user_id, supplier_email, supplier_name, isStrict = false }) => {
        await b2bConnectionService.ensureTable();
        if (!requester_user_id || !supplier_email) return null;

        const emailLower = String(supplier_email).trim().toLowerCase();
        if (!emailLower) return null;

        // 1. Strict validation: Must end with @bnxmail.com
        if (!emailLower.endsWith('@bnxmail.com')) {
            if (isStrict) {
                const err = new Error('Only @bnxmail.com business emails are allowed.');
                err.statusCode = 400;
                throw err;
            }
            return null; // Ignore non-@bnxmail.com supplier emails for background sync
        }

        // Lookup requester user details
        const requesterUser = await db.prepare('SELECT id, email, username, business_name FROM users WHERE id = ?').get(requester_user_id);
        if (!requesterUser) return null;

        // Lookup target user by email or username
        const targetUser = await db.prepare('SELECT id, email, username, business_name FROM users WHERE LOWER(email) = ? OR LOWER(username) = ?').get(emailLower, emailLower);
        if (!targetUser) {
            if (isStrict) {
                const err = new Error('No registered Cliks Business account found with this @bnxmail.com email address.');
                err.statusCode = 404;
                throw err;
            }
            return null;
        }

        if (targetUser.id === requester_user_id) {
            if (isStrict) {
                const err = new Error('Cannot create a B2B supplier connection request to your own account.');
                err.statusCode = 400;
                throw err;
            }
            return null;
        }

        const now = new Date().toISOString();
        const requesterBiz = requesterUser.business_name || requesterUser.username || 'Cliks Business';
        const targetBiz = targetUser.business_name || targetUser.username || 'Cliks Partner';

        // Check if connection already exists
        let existing = await db.prepare(`
            SELECT * FROM b2b_connections
            WHERE (requester_user_id = ? AND target_user_id = ?)
               OR (requester_user_id = ? AND target_user_id = ?)
        `).get(requester_user_id, targetUser.id, targetUser.id, requester_user_id);

        if (!existing) {
            const res = await db.prepare(`
                INSERT INTO b2b_connections (
                    requester_user_id, requester_email, requester_business_name,
                    target_user_id, target_email, target_business_name,
                    connection_type, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'Supplier Connection Request', 'PENDING', ?, ?)
            `).run(
                requester_user_id, requesterUser.email, requesterBiz,
                targetUser.id, targetUser.email, targetBiz,
                now, now
            );

            existing = await db.prepare('SELECT * FROM b2b_connections WHERE id = ?').get(res.lastInsertRowid || res.id);

            // Send Notification to Target User: "[Business Name] has requested to connect with you as a supplier."
            try {
                await db.prepare(`
                    INSERT INTO notifications (user_id, sender_id, receiver_id, type, title, message, related_task_id, is_read, created_at)
                    VALUES (?, ?, ?, 'b2b_connection_request', 'B2B Supplier Connection Request', ?, ?, 0, ?)
                `).run(
                    targetUser.id, requester_user_id, targetUser.id,
                    `${requesterBiz} has requested to connect with you as a supplier.`,
                    existing.id,
                    now
                );
            } catch (nErr) {
                console.warn('[B2B Connection] Failed to insert notification:', nErr.message);
            }
        }

        return existing;
    },

    // Get B2B connections for a user
    getConnectionsForUser: async (user_id) => {
        await b2bConnectionService.ensureTable();
        const user = await db.prepare('SELECT id, email FROM users WHERE id = ?').get(user_id);
        if (!user) return [];

        const emailLower = (user.email || '').toLowerCase();
        const rows = await db.prepare(`
            SELECT * FROM b2b_connections
            WHERE requester_user_id = ? OR target_user_id = ? OR LOWER(target_email) = ? OR LOWER(requester_email) = ?
            ORDER BY id DESC
        `).all(user_id, user_id, emailLower, emailLower);

        return rows || [];
    },

    // Respond to connection request (ACCEPT or REJECT)
    respondToConnection: async ({ user_id, connection_id, action }) => {
        await b2bConnectionService.ensureTable();

        const conn = await db.prepare('SELECT * FROM b2b_connections WHERE id = ?').get(connection_id);
        if (!conn) {
            const err = new Error('Connection request not found');
            err.statusCode = 404;
            throw err;
        }

        const currentUser = await db.prepare('SELECT id, email, username, business_name FROM users WHERE id = ?').get(user_id);
        if (!currentUser) {
            const err = new Error('User not found');
            err.statusCode = 404;
            throw err;
        }

        const isTarget = conn.target_user_id === user_id || conn.target_email.toLowerCase() === (currentUser.email || '').toLowerCase();
        const isRequester = conn.requester_user_id === user_id || conn.requester_email.toLowerCase() === (currentUser.email || '').toLowerCase();

        if (!isTarget && !isRequester) {
            const err = new Error('Unauthorized: You are not authorized to respond to this connection request');
            err.statusCode = 403;
            throw err;
        }

        const act = String(action).toUpperCase();
        if (act !== 'ACCEPT' && act !== 'ACCEPTED' && act !== 'REJECT' && act !== 'REJECTED') {
            const err = new Error('Invalid action. Must be ACCEPT or REJECT');
            err.statusCode = 400;
            throw err;
        }

        const now = new Date().toISOString();
        const newStatus = (act === 'ACCEPT' || act === 'ACCEPTED') ? 'ACCEPTED' : 'REJECTED';

        await db.prepare(`
            UPDATE b2b_connections
            SET status = ?, accepted_at = ?, updated_at = ?
            WHERE id = ?
        `).run(newStatus, newStatus === 'ACCEPTED' ? now : null, now, connection_id);

        const updated = await db.prepare('SELECT * FROM b2b_connections WHERE id = ?').get(connection_id);

        let requesterUser = await db.prepare('SELECT id, email, username, business_name FROM users WHERE id = ?').get(conn.requester_user_id);
        if (!requesterUser && conn.requester_email) {
            requesterUser = await db.prepare('SELECT id, email, username, business_name FROM users WHERE LOWER(email) = ? OR LOWER(username) = ?').get(conn.requester_email.toLowerCase(), conn.requester_email.toLowerCase());
        }

        let targetUser = await db.prepare('SELECT id, email, username, business_name FROM users WHERE id = ?').get(conn.target_user_id);
        if (!targetUser && conn.target_email) {
            targetUser = await db.prepare('SELECT id, email, username, business_name FROM users WHERE LOWER(email) = ? OR LOWER(username) = ?').get(conn.target_email.toLowerCase(), conn.target_email.toLowerCase());
        }

        const requesterName = requesterUser ? (requesterUser.business_name || requesterUser.username) : conn.requester_business_name;
        const targetName = targetUser ? (targetUser.business_name || targetUser.username) : conn.target_business_name;

        const reqEmail = (conn.requester_email || (requesterUser ? requesterUser.email : '')).toLowerCase();
        const tarEmail = (conn.target_email || (targetUser ? targetUser.email : '')).toLowerCase();

        if (newStatus === 'ACCEPTED') {
            // 1. Add Requester as Customer in Target User's business_customers table
            if (targetUser && reqEmail) {
                const existingCust = await db.prepare(`
                    SELECT id FROM business_customers
                    WHERE user_id = ? AND LOWER(email) = ?
                `).get(targetUser.id, reqEmail);

                if (!existingCust) {
                    await db.prepare(`
                        INSERT INTO business_customers (
                            user_id, name, business_name, email, phone_number, status, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, 'Connected', ?, ?)
                    `).run(
                        targetUser.id, requesterName, requesterName, reqEmail,
                        null, now, now
                    );
                } else {
                    await db.prepare(`
                        UPDATE business_customers
                        SET status = 'Connected', updated_at = ?
                        WHERE id = ?
                    `).run(now, existingCust.id);
                }
            }

            // 2. Update Target as Connected Supplier in Requester's business_suppliers table
            if (requesterUser && tarEmail) {
                const existingSupp = await db.prepare(`
                    SELECT id FROM business_suppliers
                    WHERE user_id = ? AND LOWER(email) = ?
                `).get(requesterUser.id, tarEmail);

                if (!existingSupp) {
                    await db.prepare(`
                        INSERT INTO business_suppliers (
                            user_id, name, company, email, phone, status, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, 'CONNECTED', ?, ?)
                    `).run(
                        requesterUser.id, targetName, targetName, tarEmail,
                        null, now, now
                    );
                } else {
                    await db.prepare(`
                        UPDATE business_suppliers
                        SET status = 'CONNECTED', updated_at = ?
                        WHERE id = ?
                    `).run(now, existingSupp.id);
                }
            }

            // 3. Synchronize supplier_connections & customer_connections tables
            try {
                if (requesterUser && targetUser) {
                    await db.prepare(`
                        UPDATE supplier_connections
                        SET status = 'accepted', supplier_user_id = ?, responded_at = ?, updated_at = ?
                        WHERE business_id = ? AND (supplier_user_id = ? OR LOWER(supplier_email) = ?)
                    `).run(targetUser.id, now, now, requesterUser.id, targetUser.id, tarEmail);

                    await db.prepare(`
                        UPDATE customer_connections
                        SET status = 'accepted', website_user_id = ?, responded_at = ?, updated_at = ?
                        WHERE business_id = ? AND (website_user_id = ? OR LOWER(customer_email) = ?)
                    `).run(targetUser.id, now, now, requesterUser.id, targetUser.id, tarEmail);
                }
            } catch (syncErr) {
                console.warn('[B2B Connection] Sub-connection sync warning:', syncErr.message);
            }

            // 4. Retroactively sync all purchases created by Requester for this Target Supplier
            try {
                const reqUserId = conn.requester_user_id || (requesterUser ? requesterUser.id : null);
                if (reqUserId && targetUser) {
                    const tarBiz = targetName || (targetUser.business_name || targetUser.username || '');
                    const tarMail = tarEmail || targetUser.email || '';

                    // Find purchases in business_purchases created by buyer where supplier matches target
                    const buyerPurchases = await db.prepare(`
                        SELECT * FROM business_purchases
                        WHERE user_id = ?
                          AND (
                              LOWER(supplier_name) = LOWER(?)
                              OR LOWER(supplier_name) = LOWER(?)
                              OR LOWER(supplier_name) = LOWER(?)
                              OR LOWER(billing_address) LIKE LOWER(?)
                              OR id IN (SELECT source_purchase_invoice_id FROM b2b_invoice_relationships WHERE supplier_user_id = ?)
                          )
                    `).all(reqUserId, tarBiz, tarMail, targetUser.username || '', `%${tarBiz}%`, targetUser.id);

                    console.log(`[B2B Connection Accepted] Found ${buyerPurchases ? buyerPurchases.length : 0} purchases from buyer #${reqUserId} for supplier #${targetUser.id}`);

                    for (const pur of (buyerPurchases || [])) {
                        try {
                            let purItems = [];
                            try {
                                purItems = await db.prepare('SELECT * FROM business_purchase_items WHERE purchase_id = ?').all(pur.id);
                            } catch (e) {
                                purItems = typeof pur.items === 'string' ? JSON.parse(pur.items) : (pur.items || []);
                            }

                            await b2bConnectionService.syncPurchaseToSalesInvoice({
                                purchaseId: pur.id,
                                userId: reqUserId,
                                supplierEmail: targetUser.email,
                                purchaseData: {
                                    ...pur,
                                    items: purItems
                                }
                            });
                        } catch (sErr) {
                            console.warn(`[B2B Connection Accepted] Purchase #${pur.id} sync error:`, sErr.message);
                        }
                    }

                    // Also update any already-created business_invoices from Pending Confirmation to Paid/Unpaid
                    try {
                        await db.prepare(`
                            UPDATE business_invoices
                            SET status = CASE WHEN paid_amount >= total_amount AND total_amount > 0 THEN 'Paid' ELSE 'Unpaid' END,
                                notes = REPLACE(notes, ' (Pending Confirmation)', ''),
                                updated_at = ?
                            WHERE user_id = ? 
                              AND (LOWER(client_name) = LOWER(?) OR LOWER(client_email) = LOWER(?))
                              AND status = 'Pending Confirmation'
                        `).run(now, targetUser.id, requesterName, reqEmail);
                    } catch (uErr) {}
                }
            } catch (pSyncErr) {
                console.warn('[B2B Connection Accepted] Error scanning and syncing purchases:', pSyncErr.message);
            }

            // Notification to Requester: "[Business Name] accepted your supplier connection request."
            try {
                if (conn.requester_user_id) {
                    await db.prepare(`
                        INSERT INTO notifications (user_id, sender_id, receiver_id, type, title, message, is_read, created_at)
                        VALUES (?, ?, ?, 'b2b_connection_accepted', 'Supplier Connection Accepted', ?, 0, ?)
                    `).run(
                        conn.requester_user_id, user_id, conn.requester_user_id,
                        `${targetName} accepted your supplier connection request.`,
                        now
                    );
                }
            } catch (nErr) {}
        } else {
            // REJECTED
            if (requesterUser) {
                await db.prepare(`
                    UPDATE business_suppliers
                    SET status = 'REJECTED', updated_at = ?
                    WHERE user_id = ? AND LOWER(email) = ?
                `).run(now, requesterUser.id, conn.target_email.toLowerCase());
            }

            try {
                await db.prepare(`
                    INSERT INTO notifications (user_id, sender_id, receiver_id, type, title, message, is_read, created_at)
                    VALUES (?, ?, ?, 'b2b_connection_rejected', 'Supplier Connection Declined', ?, 0, ?)
                `).run(
                    conn.requester_user_id, user_id, conn.requester_user_id,
                    `${targetName} declined your supplier connection request.`,
                    now
                );
            } catch (nErr) {}
        }

        return updated;
    },

    // Sync Purchase Invoice to Target Supplier's Sales Invoice
    syncPurchaseToSalesInvoice: async ({ purchaseId, userId, supplierEmail, purchaseData }) => {
        await b2bConnectionService.ensureTable();
        if (!purchaseId || !userId || !supplierEmail) return null;

        const emailLower = String(supplierEmail).trim().toLowerCase();
        if (!emailLower) return null;

        // Lookup supplier user by email or username
        let supplierUser = await db.prepare('SELECT id, email, username, business_name FROM users WHERE LOWER(email) = ? OR LOWER(username) = ?').get(emailLower, emailLower);
        if (!supplierUser || supplierUser.id === userId) return null;

        // Security check: Verify that a connection exists between buyer and supplier
        const connection = await db.prepare(`
            SELECT * FROM b2b_connections
            WHERE ((requester_user_id = ? AND target_user_id = ?) OR (requester_user_id = ? AND target_user_id = ?))
        `).get(userId, supplierUser.id, supplierUser.id, userId);

        if (!connection) {
            console.log(`[B2B Invoice Sync Security] No connection between user #${userId} and supplier #${supplierUser.id} (${supplierEmail}). Sync blocked.`);
            return null;
        }

        const isAccepted = connection.status === 'ACCEPTED';
        const connectionTxId = `B2B-TXN-PO-${purchaseId}`;
        const now = new Date().toISOString();

        // Idempotency check: verify transaction hasn't already been synced
        const existingRel = await db.prepare(`
            SELECT * FROM b2b_invoice_relationships
            WHERE source_purchase_invoice_id = ? OR connection_transaction_id = ?
        `).get(purchaseId, connectionTxId);

        if (existingRel) {
            console.log(`[B2B Invoice Sync] Transaction #${purchaseId} already synced via rel #${existingRel.id}. Skipping duplicate.`);
            if (isAccepted) {
                try {
                    await db.prepare(`
                        UPDATE business_invoices
                        SET status = CASE WHEN paid_amount >= total_amount AND total_amount > 0 THEN 'Paid' ELSE 'Unpaid' END,
                            notes = REPLACE(notes, ' (Pending Confirmation)', ''),
                            updated_at = ?
                        WHERE id = ? AND status = 'Pending Confirmation'
                    `).run(now, existingRel.generated_sales_invoice_id);
                } catch(e) {}
            }
            return existingRel;
        }

        const buyerUser = await db.prepare('SELECT id, email, username, business_name FROM users WHERE id = ?').get(userId);
        const buyerName = buyerUser ? (buyerUser.business_name || buyerUser.username || 'Connected Buyer') : 'Connected Buyer';

        const purNum = purchaseData.purchase_number || `PO-${purchaseId}`;
        const salesInvoiceNumber = `INV-${purNum}`;

        const itemsStr = typeof purchaseData.items === 'string'
            ? purchaseData.items
            : JSON.stringify(purchaseData.items || []);

        const isPaid = purchaseData.payment_status === 'paid' || purchaseData.status === 'Paid';
        const invStatus = isAccepted ? (isPaid ? 'Paid' : 'Unpaid') : 'Pending Confirmation';
        const sourceNote = isAccepted 
            ? `Source: Purchase Invoice from ${buyerName}` 
            : `Source: Purchase Invoice from ${buyerName} (Pending Confirmation)`;

        // Create Sales Invoice for Supplier
        const salesInvRes = await db.prepare(`
            INSERT INTO business_invoices (
                user_id, invoice_number, client_name, client_email, billing_address,
                amount, tax_amount, total_amount, paid_amount, due_amount, discount_amount,
                status, due_date, payment_mode, invoice_type, items, notes,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'B2B', ?, ?, ?, ?)
        `).run(
            supplierUser.id, salesInvoiceNumber, buyerName, buyerUser ? buyerUser.email : null, purchaseData.billing_address || null,
            parseFloat(purchaseData.subtotal) || 0, parseFloat(purchaseData.total_tax) || 0,
            parseFloat(purchaseData.grand_total) || 0, isPaid ? (parseFloat(purchaseData.grand_total) || 0) : (parseFloat(purchaseData.paid_amount) || 0),
            isPaid ? 0 : ((parseFloat(purchaseData.grand_total) || 0) - (parseFloat(purchaseData.paid_amount) || 0)),
            parseFloat(purchaseData.total_discount) || 0,
            invStatus, purchaseData.due_date || purchaseData.purchase_date || now.split('T')[0],
            purchaseData.payment_mode || 'Credit', itemsStr, sourceNote,
            now, now
        );

        const salesInvoiceId = salesInvRes.lastInsertRowid || salesInvRes.id;

        // Store relationship record
        const relRes = await db.prepare(`
            INSERT INTO b2b_invoice_relationships (
                source_purchase_invoice_id, generated_sales_invoice_id,
                buyer_user_id, buyer_email, supplier_user_id, supplier_email,
                connection_id, connection_transaction_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            purchaseId, salesInvoiceId,
            userId, buyerUser ? buyerUser.email : null, supplierUser.id, supplierUser.email,
            connection.id, connectionTxId, now
        );

        // Send Notification to Supplier: "New purchase invoice received from [Business Name]."
        try {
            await db.prepare(`
                INSERT INTO notifications (user_id, sender_id, receiver_id, type, title, message, related_task_id, is_read, created_at)
                VALUES (?, ?, ?, 'b2b_purchase_invoice_received', 'New Purchase Invoice Received', ?, ?, 0, ?)
            `).run(
                supplierUser.id, userId, supplierUser.id,
                `New purchase invoice received from ${buyerName}.`,
                salesInvoiceId,
                now
            );
        } catch (nErr) {
            console.warn('[B2B Invoice Sync] Notification error:', nErr.message);
        }

        console.log(`[B2B Invoice Sync] Successfully created Sales Invoice #${salesInvoiceId} for Supplier #${supplierUser.id} from Purchase Invoice #${purchaseId}`);
        return { salesInvoiceId, relationshipId: relRes.lastInsertRowid || relRes.id };
    }
};

module.exports = b2bConnectionService;
