const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const supplierConnectionService = require('../utils/supplierConnectionService');

function normalizePaymentMode(mode) {
    if (!mode) return 'Cash in Hand';
    const m = String(mode).toLowerCase();
    if (m === 'cash' || m.includes('cash in hand') || m.includes('hand')) {
        return 'Cash in Hand';
    }
    if (m.includes('hdfc')) {
        return 'HDFC Bank Account';
    }
    if (m.includes('icici')) {
        return 'ICICI Bank Account';
    }
    if (m.includes('sbi') || m.includes('state bank')) {
        return 'SBI Current Account';
    }
    if (m === 'upi' || m.includes('razorpay') || m.includes('gpay') || m.includes('phonepe') || m.includes('paytm')) {
        return 'UPI / Razorpay';
    }
    if (m === 'bank' || m.includes('bank')) {
        return 'HDFC Bank Account';
    }
    return mode;
}

const supplierController = {
    // 1. Create Supplier
    createSupplier: async (req, res) => {
        const { name, email, phone, company, gstin, city, outstanding_balance, total_purchased, status } = req.body;
        if (!name) return sendError(res, 'Supplier name is required', 400);

        try {
            const now = new Date().toISOString();
            const initialStatus = status || 'PENDING';
            const result = await db.prepare(`
                INSERT INTO business_suppliers (
                    user_id, name, email, phone, company, gstin, status, city, outstanding_balance, total_purchased, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                req.user.id, name, email || null, phone || null, company || null, gstin || null, initialStatus, city || null,
                outstanding_balance || 0, total_purchased || 0, now, now
            );

            const created = await db.prepare('SELECT * FROM business_suppliers WHERE id = ?').get(result.lastInsertRowid);
            
            // Sync connection request for website supplier portal
            await supplierConnectionService.syncSupplierConnectionOnCreateOrUpdate({
                business_id: req.user.id,
                supplier_id: created.id,
                supplier_email: created.email
            });

            const connStatus = await supplierConnectionService.getSupplierConnectionStatus(req.user.id, created.id, created.email);
            return sendSuccess(res, { ...created, status: connStatus, connection_status: connStatus }, 'Supplier registered successfully with status PENDING', 201);
        } catch (error) {
            console.error('[Supplier Controller] Error creating supplier:', error);
            return sendError(res, 'Failed to create supplier', 500);
        }
    },

    // 2. Get Suppliers with optional Filtering & Connection Status
    getSuppliers: async (req, res) => {
        const { search, status, city } = req.query;
        try {
            let query = `SELECT * FROM business_suppliers WHERE user_id = ?`;
            const params = [req.user.id];

            if (status && status !== 'All') {
                query += ` AND (LOWER(status) = LOWER(?) OR status = ?)`;
                params.push(status, status);
            }
            if (city) {
                query += ` AND city LIKE ?`;
                params.push(`%${city}%`);
            }
            if (search) {
                query += ` AND (name LIKE ? OR company LIKE ? OR phone LIKE ?)`;
                params.push(`%${search}%`, `%${search}%`, `%${search}%`);
            }

            query += ` ORDER BY name ASC`;
            const suppliers = await db.prepare(query).all(...params);

            const enriched = await Promise.all((suppliers || []).map(async s => {
                const connStatus = await supplierConnectionService.getSupplierConnectionStatus(req.user.id, s.id, s.email);
                const displaySt = (s.status === 'CONNECTED' || s.status === 'ACCEPTED') ? 'CONNECTED' : (connStatus || s.status || 'PENDING');
                return {
                    ...s,
                    status: displaySt,
                    connection_status: displaySt
                };
            }));

            return sendSuccess(res, enriched, 'Suppliers retrieved successfully');
        } catch (error) {
            console.error('[Supplier Controller] Error fetching suppliers:', error);
            return sendError(res, 'Failed to retrieve suppliers', 500);
        }
    },

    // 3. Get Supplier by ID
    getSupplierById: async (req, res) => {
        const { id } = req.params;
        try {
            const supplier = await db.prepare('SELECT * FROM business_suppliers WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!supplier) return sendError(res, 'Supplier not found', 404);
            return sendSuccess(res, supplier, 'Supplier details retrieved successfully');
        } catch (error) {
            return sendError(res, 'Failed to retrieve supplier details', 500);
        }
    },

    // 4. Update Supplier
    updateSupplier: async (req, res) => {
        const { id } = req.params;
        const { name, email, phone, company, gstin, status, city, outstanding_balance, total_purchased } = req.body;
        try {
            const supplier = await db.prepare('SELECT id FROM business_suppliers WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!supplier) return sendError(res, 'Supplier not found', 404);

            await db.prepare(`
                UPDATE business_suppliers SET
                    name = ?, email = ?, phone = ?, company = ?, gstin = ?, status = ?, city = ?,
                    outstanding_balance = ?, total_purchased = ?, updated_at = ?
                WHERE id = ?
            `).run(
                name, email || null, phone || null, company || null, gstin || null, status || 'active', city || null,
                outstanding_balance || 0, total_purchased || 0, new Date().toISOString(), id
            );

            const updated = await db.prepare('SELECT * FROM business_suppliers WHERE id = ?').get(id);
            return sendSuccess(res, updated, 'Supplier updated successfully');
        } catch (error) {
            return sendError(res, 'Failed to update supplier', 500);
        }
    },

    // 5. Delete Supplier
    deleteSupplier: async (req, res) => {
        const { id } = req.params;
        try {
            const supplier = await db.prepare('SELECT id FROM business_suppliers WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!supplier) return sendError(res, 'Supplier not found', 404);

            await db.prepare('DELETE FROM business_suppliers WHERE id = ?').run(id);
            return sendSuccess(res, null, 'Supplier deleted successfully');
        } catch (error) {
            return sendError(res, 'Failed to delete supplier', 500);
        }
    },

    // 6. Search Suppliers
    searchSuppliers: async (req, res) => {
        const { q } = req.query;
        try {
            const wildcard = `%${q || ''}%`;
            const suppliers = await db.prepare(`
                SELECT * FROM business_suppliers
                WHERE user_id = ? AND (name LIKE ? OR company LIKE ? OR email LIKE ? OR phone LIKE ?)
            `).all(req.user.id, wildcard, wildcard, wildcard, wildcard);
            return sendSuccess(res, suppliers, 'Suppliers matched successfully');
        } catch (error) {
            return sendError(res, 'Search failed', 500);
        }
    },

    // 7. Ledger & Outstanding
    getLedger: async (req, res) => {
        const { id } = req.params;
        try {
            const ledger = await db.prepare('SELECT * FROM supplier_ledger WHERE supplier_id = ? AND user_id = ? ORDER BY created_at DESC').all(id, req.user.id);
            return sendSuccess(res, ledger, 'Ledger loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load ledger', 500);
        }
    },

    getOutstanding: async (req, res) => {
        const { id } = req.params;
        try {
            const balance = await db.prepare('SELECT outstanding_balance FROM business_suppliers WHERE id = ? AND user_id = ?').get(id, req.user.id);
            return sendSuccess(res, balance, 'Outstanding balance loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load outstanding balance', 500);
        }
    },

    getOutstandingList: async (req, res) => {
        try {
            const list = await db.prepare('SELECT id, name, company, outstanding_balance FROM business_suppliers WHERE user_id = ? AND outstanding_balance > 0').all(req.user.id);
            return sendSuccess(res, list, 'Outstanding list loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load outstanding list', 500);
        }
    },

    // 8. Purchases, Payments, Returns per supplier
    getPurchases: async (req, res) => {
        const { id } = req.params;
        try {
            const supplier = await db.prepare('SELECT name FROM business_suppliers WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!supplier) return sendError(res, 'Supplier not found', 404);

            const purchases = await db.prepare('SELECT * FROM business_purchases WHERE user_id = ? AND supplier_name = ? AND doc_type = \'BILL\'').all(req.user.id, supplier.name);
            return sendSuccess(res, purchases, 'Supplier purchases loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load supplier purchases', 500);
        }
    },

    getPayments: async (req, res) => {
        const { id } = req.params;
        try {
            const payments = await db.prepare('SELECT * FROM supplier_payments WHERE supplier_id = ? AND user_id = ?').all(id, req.user.id);
            return sendSuccess(res, payments, 'Supplier payments loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load supplier payments', 500);
        }
    },

    getReturns: async (req, res) => {
        const { id } = req.params;
        try {
            const supplier = await db.prepare('SELECT name FROM business_suppliers WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!supplier) return sendError(res, 'Supplier not found', 404);

            const returns = await db.prepare('SELECT * FROM business_purchases WHERE user_id = ? AND supplier_name = ? AND doc_type = \'RETURN\'').all(req.user.id, supplier.name);
            return sendSuccess(res, returns, 'Supplier returns loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load supplier returns', 500);
        }
    },

    // 9. Post Payments
    createPayment: async (req, res) => {
        const { id } = req.params;
        const { amount, payment_method, reference_number } = req.body;
        try {
            const result = await db.prepare(`
                INSERT INTO supplier_payments (supplier_id, user_id, amount, payment_method, reference_number, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(id, req.user.id, amount, payment_method, reference_number || null, new Date().toISOString());

            // Update Supplier Balance
            await db.prepare('UPDATE business_suppliers SET outstanding_balance = outstanding_balance - ? WHERE id = ?').run(amount, id);

            // Log to Ledger
            await db.prepare(`
                INSERT INTO supplier_ledger (supplier_id, user_id, description, amount, type, created_at)
                VALUES (?, ?, ?, ?, 'credit', ?)
            `).run(id, req.user.id, `Payment made via ${payment_method}`, amount, new Date().toISOString());

            // Sync to accounting
            const normalizedMode = normalizePaymentMode(payment_method);
            const now = new Date().toISOString();
            const paymentId = result.lastInsertRowid;
            await db.prepare(`
                INSERT INTO accounting (user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at)
                VALUES (?, 'expense', ?, ?, ?, ?, ?, 'posted', ?, ?)
            `).run(req.user.id, now.split('T')[0], amount, 'Supplier Payments', normalizedMode, `Supplier Payment #${paymentId}`, now, now);

            const created = await db.prepare('SELECT * FROM supplier_payments WHERE id = ?').get(result.lastInsertRowid);
            return sendSuccess(res, created, 'Payment registered successfully', 201);
        } catch (error) {
            return sendError(res, 'Failed to log payment', 500);
        }
    },

    getPaymentHistory: async (req, res) => {
        const { id } = req.params;
        try {
            const history = await db.prepare('SELECT * FROM supplier_payments WHERE supplier_id = ? AND user_id = ? ORDER BY created_at DESC').all(id, req.user.id);
            return sendSuccess(res, history, 'Payment history retrieved successfully');
        } catch (error) {
            return sendError(res, 'Failed to load payment history', 500);
        }
    },

    // 10. Address Management
    createAddress: async (req, res) => {
        const { id } = req.params;
        const { address_line1, address_line2, city, state, postal_code, country } = req.body;
        try {
            const result = await db.prepare(`
                INSERT INTO supplier_addresses (supplier_id, user_id, address_line1, address_line2, city, state, postal_code, country, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(id, req.user.id, address_line1, address_line2 || null, city, state, postal_code, country || 'India', new Date().toISOString());

            const created = await db.prepare('SELECT * FROM supplier_addresses WHERE id = ?').get(result.lastInsertRowid);
            return sendSuccess(res, created, 'Address added successfully', 201);
        } catch (error) {
            return sendError(res, 'Failed to add address', 500);
        }
    },

    updateAddress: async (req, res) => {
        const { id, addressId } = req.params;
        const { address_line1, address_line2, city, state, postal_code, country } = req.body;
        try {
            await db.prepare(`
                UPDATE supplier_addresses SET
                    address_line1 = ?, address_line2 = ?, city = ?, state = ?, postal_code = ?, country = ?
                WHERE id = ? AND supplier_id = ?
            `).run(address_line1, address_line2 || null, city, state, postal_code, country || 'India', addressId, id);

            const updated = await db.prepare('SELECT * FROM supplier_addresses WHERE id = ?').get(addressId);
            return sendSuccess(res, updated, 'Address updated successfully');
        } catch (error) {
            return sendError(res, 'Failed to update address', 500);
        }
    },

    // 11. Contacts Management
    createContact: async (req, res) => {
        const { id } = req.params;
        const { contact_name, email, phone, designation } = req.body;
        try {
            const result = await db.prepare(`
                INSERT INTO supplier_contacts (supplier_id, user_id, contact_name, email, phone, designation, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(id, req.user.id, contact_name, email || null, phone || null, designation || null, new Date().toISOString());

            const created = await db.prepare('SELECT * FROM supplier_contacts WHERE id = ?').get(result.lastInsertRowid);
            return sendSuccess(res, created, 'Contact added successfully', 201);
        } catch (error) {
            return sendError(res, 'Failed to add contact', 500);
        }
    },

    getContacts: async (req, res) => {
        const { id } = req.params;
        try {
            const contacts = await db.prepare('SELECT * FROM supplier_contacts WHERE supplier_id = ? AND user_id = ?').all(id, req.user.id);
            return sendSuccess(res, contacts, 'Contacts retrieved successfully');
        } catch (error) {
            return sendError(res, 'Failed to load contacts', 500);
        }
    },

    updateContact: async (req, res) => {
        const { id, contactId } = req.params;
        const { contact_name, email, phone, designation } = req.body;
        try {
            await db.prepare(`
                UPDATE supplier_contacts SET
                    contact_name = ?, email = ?, phone = ?, designation = ?
                WHERE id = ? AND supplier_id = ?
            `).run(contact_name, email || null, phone || null, designation || null, contactId, id);

            const updated = await db.prepare('SELECT * FROM supplier_contacts WHERE id = ?').get(contactId);
            return sendSuccess(res, updated, 'Contact updated successfully');
        } catch (error) {
            return sendError(res, 'Failed to update contact', 500);
        }
    },

    deleteContact: async (req, res) => {
        const { id, contactId } = req.params;
        try {
            await db.prepare('DELETE FROM supplier_contacts WHERE id = ? AND supplier_id = ?').run(contactId, id);
            return sendSuccess(res, null, 'Contact deleted successfully');
        } catch (error) {
            return sendError(res, 'Failed to delete contact', 500);
        }
    },

    // 12. Notes Management
    createNote: async (req, res) => {
        const { id } = req.params;
        const { note } = req.body;
        try {
            const result = await db.prepare(`
                INSERT INTO supplier_notes (supplier_id, user_id, note, created_at)
                VALUES (?, ?, ?, ?)
            `).run(id, req.user.id, note, new Date().toISOString());

            const created = await db.prepare('SELECT * FROM supplier_notes WHERE id = ?').get(result.lastInsertRowid);
            return sendSuccess(res, created, 'Note added successfully', 201);
        } catch (error) {
            return sendError(res, 'Failed to add note', 500);
        }
    },

    getNotes: async (req, res) => {
        const { id } = req.params;
        try {
            const notes = await db.prepare('SELECT * FROM supplier_notes WHERE supplier_id = ? AND user_id = ?').all(id, req.user.id);
            return sendSuccess(res, notes, 'Notes loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load notes', 500);
        }
    },

    // 13. Documents Management
    createDocument: async (req, res) => {
        const { id } = req.params;
        const { file_name, file_url, file_size } = req.body;
        try {
            const result = await db.prepare(`
                INSERT INTO supplier_documents (supplier_id, user_id, file_name, file_url, file_size, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(id, req.user.id, file_name, file_url || null, file_size || null, new Date().toISOString());

            const created = await db.prepare('SELECT * FROM supplier_documents WHERE id = ?').get(result.lastInsertRowid);
            return sendSuccess(res, created, 'Document attached successfully', 201);
        } catch (error) {
            return sendError(res, 'Failed to attach document', 500);
        }
    },

    getDocuments: async (req, res) => {
        const { id } = req.params;
        try {
            const docs = await db.prepare('SELECT * FROM supplier_documents WHERE supplier_id = ? AND user_id = ?').all(id, req.user.id);
            return sendSuccess(res, docs, 'Documents retrieved successfully');
        } catch (error) {
            return sendError(res, 'Failed to load documents', 500);
        }
    },

    // 14. Analytics & Reports
    getAnalytics: async (req, res) => {
        const { id } = req.params;
        try {
            const analytics = await db.prepare(`
                SELECT outstanding_balance, total_purchased
                FROM business_suppliers WHERE id = ? AND user_id = ?
            `).get(id, req.user.id);
            return sendSuccess(res, analytics, 'Analytics loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load analytics', 500);
        }
    },

    getPurchasesReport: async (req, res) => {
        try {
            const report = await db.prepare(`
                SELECT supplier_name, COUNT(*) as count, COALESCE(SUM(grand_total), 0) as total
                FROM business_purchases WHERE user_id = ? AND doc_type = 'BILL'
                GROUP BY supplier_name
            `).all(req.user.id);
            return sendSuccess(res, report, 'Purchases report loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load purchases report', 500);
        }
    },

    getBalanceReport: async (req, res) => {
        try {
            const report = await db.prepare(`
                SELECT name, company, outstanding_balance
                FROM business_suppliers WHERE user_id = ? AND outstanding_balance > 0
            `).all(req.user.id);
            return sendSuccess(res, report, 'Balance report loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load balance report', 500);
        }
    },

    getTopSuppliersReport: async (req, res) => {
        try {
            const report = await db.prepare(`
                SELECT name, company, total_purchased
                FROM business_suppliers WHERE user_id = ?
                ORDER BY total_purchased DESC LIMIT 5
            `).all(req.user.id);
            return sendSuccess(res, report, 'Top suppliers report loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load top suppliers report', 500);
        }
    },

    getPaymentsReport: async (req, res) => {
        try {
            const report = await db.prepare(`
                SELECT payment_method, COALESCE(SUM(amount), 0) as total
                FROM supplier_payments WHERE user_id = ?
                GROUP BY payment_method
            `).all(req.user.id);
            return sendSuccess(res, report, 'Payments report loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load payments report', 500);
        }
    },

    // 15. Import / Export
    importSuppliers: async (req, res) => {
        const { suppliers } = req.body;
        if (!suppliers || !Array.isArray(suppliers)) {
            return sendError(res, 'Suppliers array is required', 400);
        }

        try {
            const now = new Date().toISOString();
            const importTx = db.transaction(async () => {
                const insertStmt = db.prepare(`
                    INSERT INTO business_suppliers (
                        user_id, name, email, phone, company, gstin, status, city, outstanding_balance, total_purchased, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
                `);

                for (const item of suppliers) {
                    if (!item.name) {
                        throw new Error('Supplier name is required for all imported suppliers');
                    }
                    await insertStmt.run(
                        req.user.id,
                        item.name,
                        item.email || null,
                        item.phone || null,
                        item.company || null,
                        item.gstin || null,
                        item.city || null,
                        item.outstanding_balance || 0,
                        item.total_purchased || 0,
                        now,
                        now
                    );
                }
                return suppliers.length;
            });

            const count = await importTx();
            return sendSuccess(res, { count }, `${count} suppliers imported successfully`);
        } catch (error) {
            console.error('[Supplier Controller] Error importing suppliers:', error);
            return sendError(res, error.message || 'Failed to import suppliers', 500);
        }
    },

    exportSuppliers: async (req, res) => {
        try {
            const data = await db.prepare('SELECT * FROM business_suppliers WHERE user_id = ?').all(req.user.id);
            return sendSuccess(res, data, 'Suppliers exported successfully');
        } catch (error) {
            return sendError(res, 'Failed to export suppliers', 500);
        }
    },

    // 16. History & Timelines
    getHistory: async (req, res) => {
        return sendSuccess(res, [], 'History loaded successfully');
    },

    getTimeline: async (req, res) => {
        return sendSuccess(res, [], 'Timeline loaded successfully');
    },

    // 17. Block / Unblock Actions
    blockSupplier: async (req, res) => {
        const { id } = req.params;
        try {
            await db.prepare('UPDATE business_suppliers SET status = \'blocked\' WHERE id = ?').run(id);
            return sendSuccess(res, { id, status: 'blocked' }, 'Supplier blocked successfully');
        } catch (error) {
            return sendError(res, 'Failed to block supplier', 500);
        }
    },

    unblockSupplier: async (req, res) => {
        const { id } = req.params;
        try {
            await db.prepare('UPDATE business_suppliers SET status = \'active\' WHERE id = ?').run(id);
            return sendSuccess(res, { id, status: 'active' }, 'Supplier unblocked successfully');
        } catch (error) {
            return sendError(res, 'Failed to unblock supplier', 500);
        }
    },

    // 18. Dashboard Summary
    getDashboardSummary: async (req, res) => {
        try {
            const summary = await db.prepare(`
                SELECT COUNT(*) as supplier_count, COALESCE(SUM(outstanding_balance), 0) as total_outflow
                FROM business_suppliers WHERE user_id = ?
            `).get(req.user.id);
            return sendSuccess(res, summary, 'Dashboard summary loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load dashboard summary', 500);
        }
    },

    // 19. Dealer <-> Supplier Chat
    getChats: async (req, res) => {
        const { id } = req.params;
        const { purchase_id } = req.query;
        try {
            const chats = await supplierConnectionService.getSupplierChats({
                business_id: req.user.id,
                supplier_id: id,
                purchase_id: purchase_id ? parseInt(purchase_id) : null
            });
            return sendSuccess(res, chats, 'Supplier chat messages loaded');
        } catch (error) {
            return sendError(res, error.message || 'Failed to load chat messages', 500);
        }
    },

    sendChatMessage: async (req, res) => {
        const { id } = req.params;
        const { message, purchase_id, sender_type } = req.body;
        try {
            const created = await supplierConnectionService.sendSupplierChatMessage({
                business_id: req.user.id,
                supplier_id: id,
                purchase_id: purchase_id ? parseInt(purchase_id) : null,
                sender_type: sender_type || 'dealer',
                sender_id: req.user.id,
                sender_name: req.user.business_name || req.user.username || 'Dealer',
                message
            });
            return sendSuccess(res, created, 'Message sent successfully', 201);
        } catch (error) {
            return sendError(res, error.message || 'Failed to send chat message', 400);
        }
    },

    // 20. Website Supplier Portal Integration
    getPortalIntegrations: async (req, res) => {
        try {
            const integrations = await supplierConnectionService.getWebsiteSupplierIntegrations(req.user.id, req.user.email);
            return sendSuccess(res, integrations, 'Supplier connection integrations retrieved');
        } catch (error) {
            return sendError(res, error.message || 'Failed to retrieve supplier integrations', 500);
        }
    },

    getConnectionRequests: async (req, res) => {
        return supplierController.getPortalIntegrations(req, res);
    },

    respondPortalIntegration: async (req, res) => {
        const { id } = req.params;
        const { action } = req.body;
        try {
            const updated = await supplierConnectionService.respondToSupplierIntegrationRequest({
                website_user_id: req.user.id,
                website_user_email: req.user.email,
                connection_id: id,
                action
            });
            return sendSuccess(res, updated, `Supplier connection ${action}ed successfully`);
        } catch (error) {
            return sendError(res, error.message || 'Failed to respond to supplier connection', 400);
        }
    },

    respondConnectionRequest: async (req, res) => {
        return supplierController.respondPortalIntegration(req, res);
    },

    getPurchaseRequests: async (req, res) => {
        const purchaseController = require('./purchaseController');
        return purchaseController.getSupplierPortalOrders(req, res);
    },

    getPurchaseRequestById: async (req, res) => {
        const purchaseController = require('./purchaseController');
        return purchaseController.getPurchaseById(req, res);
    },

    confirmPurchaseOrder: async (req, res) => {
        const purchaseController = require('./purchaseController');
        return purchaseController.confirmSupplierPurchase(req, res);
    },

    getChatMessages: async (req, res) => {
        const supplierId = req.params.supplierId || req.params.id;
        const { purchase_id } = req.query;
        try {
            const chats = await supplierConnectionService.getSupplierChats({
                business_id: req.user.id,
                supplier_id: supplierId,
                purchase_id: purchase_id ? parseInt(purchase_id) : null
            });
            return sendSuccess(res, chats, 'Supplier chat messages loaded');
        } catch (error) {
            return sendError(res, error.message || 'Failed to load chat messages', 500);
        }
    }
};

module.exports = supplierController;
