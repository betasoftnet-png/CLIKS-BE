const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { logAuditEvent } = require('../utils/auditLogger');
const connectionService = require('../utils/connectionService');
const { validatePhone, validateEmail, validateGstin, validatePan } = require('../utils/globalValidator');

const customerController = {
    lookupCustomerByEmail: async (req, res) => {
        try {
            const { email } = req.query;
            if (!email || !String(email).trim()) {
                return sendSuccess(res, { exists: false, loyalty_points: 0 });
            }

            const emailLower = String(email).trim().toLowerCase();

            // 1. Search merchant's business_customers table FIRST for merchant context
            const crmCust = await db.prepare('SELECT id, name, email, loyalty_points FROM business_customers WHERE LOWER(email) = ? AND user_id = ?').get(emailLower, req.user.id);

            if (crmCust) {
                return sendSuccess(res, {
                    exists: true,
                    user_id: crmCust.id,
                    email: crmCust.email,
                    customer_name: crmCust.name,
                    loyalty_points: parseFloat(crmCust.loyalty_points || 0) || 0
                });
            }

            // 2. Search users table for registered CLIKS customer user account as fallback
            const user = await db.prepare('SELECT id, email, username, loyalty_points FROM users WHERE LOWER(email) = ?').get(emailLower);

            if (user) {
                // Check customer_loyalty_wallets table for live balance
                const wallet = await db.prepare('SELECT points_balance FROM customer_loyalty_wallets WHERE user_id = ?').get(user.id);
                const pts = wallet ? (wallet.points_balance || 0) : (user.loyalty_points || 0);

                return sendSuccess(res, {
                    exists: true,
                    user_id: user.id,
                    email: user.email,
                    customer_name: user.username,
                    loyalty_points: parseFloat(pts || 0) || 0
                });
            }

            return sendSuccess(res, {
                exists: false,
                email: emailLower,
                loyalty_points: 0
            });
        } catch (error) {
            console.error('[Customer Lookup Error]', error);
            return sendError(res, 'Failed to lookup customer by email', 500);
        }
    },

    getCustomers: async (req, res) => {
        try {
            const userId = req.user.id;
            const { q, status, state, page = 1, limit = 50 } = req.query;
            const offset = (parseInt(page) - 1) * parseInt(limit);

            let sql = "SELECT * FROM business_customers WHERE user_id = ?";
            const params = [userId];

            if (q) {
                sql += " AND (name LIKE ? OR company LIKE ? OR email LIKE ? OR phone LIKE ? OR gstin LIKE ?)";
                const searchTerm = `%${q}%`;
                params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
            }

            if (status) {
                sql += " AND status = ?";
                params.push(status);
            }

            if (state) {
                sql += " AND state = ?";
                params.push(state);
            }

            // Total count query
            const countSql = sql.replace("SELECT *", "SELECT COUNT(*) as total");
            const totalRes = await db.prepare(countSql).get(...params);
            const total = totalRes ? totalRes.total : 0;

            sql += " ORDER BY id DESC LIMIT ? OFFSET ?";
            params.push(parseInt(limit), offset);

            const customers = await db.prepare(sql).all(...params);
            if (!customers || customers.length === 0) {
                return sendSuccess(res, { customers: [], total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) }, 'Customers fetched successfully');
            }

            // Batch fetch connections
            let connections = [];
            try {
                connections = await db.prepare('SELECT * FROM customer_connections WHERE business_id = ?').all(userId);
            } catch (e) {}

            const connMapByCustId = new Map();
            const connMapByEmail = new Map();
            (connections || []).forEach(conn => {
                const st = String(conn.status || '').toLowerCase();
                const status = (st === 'accepted' || st === 'connected') ? 'CONNECTED' : (st === 'pending' ? 'PENDING' : 'UNCONNECTED');
                if (conn.business_customer_id) connMapByCustId.set(conn.business_customer_id, status);
                if (conn.customer_email) connMapByEmail.set(String(conn.customer_email).toLowerCase(), status);
            });

            // Batch aggregate sales
            let salesRows = [];
            try {
                salesRows = await db.prepare(`
                    SELECT LOWER(client_email) as email, LOWER(client_name) as name, SUM(COALESCE(total_amount, amount, 0)) as total_sales
                    FROM business_invoices
                    WHERE user_id = ?
                      AND (status IS NULL OR LOWER(status) NOT IN ('cancelled', 'canceled', 'deleted', 'trash'))
                    GROUP BY LOWER(client_email), LOWER(client_name)
                `).all(userId);
            } catch (e) {}

            const salesByEmail = new Map();
            const salesByName = new Map();
            (salesRows || []).forEach(r => {
                const val = parseFloat(r.total_sales) || 0;
                if (r.email) salesByEmail.set(r.email, (salesByEmail.get(r.email) || 0) + val);
                if (r.name) salesByName.set(r.name, (salesByName.get(r.name) || 0) + val);
            });

            const normalized = customers.map(c => {
                const phoneVal = c.phone_number || c.phone || '';
                const panVal = c.pan_number || c.pan || '';
                const addrVal = c.billing_address || c.address || '';
                const emailLower = c.email ? String(c.email).toLowerCase().trim() : '';
                const nameLower = c.name ? String(c.name).toLowerCase().trim() : '';

                const connStatus = connMapByCustId.get(c.id) || (emailLower ? connMapByEmail.get(emailLower) : null) || 'UNCONNECTED';
                const totalSales = (emailLower ? salesByEmail.get(emailLower) : 0) || (nameLower ? salesByName.get(nameLower) : 0) || 0;
                const loyaltyPts = parseFloat(c.loyalty_points || 0) || 0;

                return {
                    ...c,
                    loyalty_points: loyaltyPts,
                    points: loyaltyPts,
                    phone: phoneVal,
                    phone_number: phoneVal,
                    pan: panVal,
                    pan_number: panVal,
                    address: addrVal,
                    billing_address: addrVal,
                    connection_status: connStatus,
                    connectionStatus: connStatus,
                    total_sales: totalSales,
                    totalSales: totalSales,
                    total_spent: totalSales
                };
            });

            let b2bRequests = [];
            try {
                const b2bConnectionService = require('../utils/b2bConnectionService');
                const b2bConns = await b2bConnectionService.getConnectionsForUser(userId);
                
                (b2bConns || []).forEach(b => {
                    const isTarget = b.target_user_id === userId || (b.target_email && b.target_email.toLowerCase() === (req.user.email || '').toLowerCase());
                    const otherName = isTarget ? b.requester_business_name : b.target_business_name;
                    const otherEmail = isTarget ? b.requester_email : b.target_email;

                    const existingInNorm = normalized.find(nc => nc.email && nc.email.toLowerCase() === (otherEmail || '').toLowerCase());
                    
                    if (existingInNorm) {
                        existingInNorm.b2b_connection_id = b.id;
                        existingInNorm.connection_type = 'Supplier Connection Request';
                        existingInNorm.request_date = b.created_at ? b.created_at.split('T')[0] : '';
                        if (b.status === 'ACCEPTED') {
                            existingInNorm.status = 'Connected';
                            existingInNorm.connection_status = 'CONNECTED';
                            existingInNorm.customer_type = 'ACCEPTED';
                        } else if (b.status === 'REJECTED') {
                            existingInNorm.status = 'Rejected';
                            existingInNorm.connection_status = 'REJECTED';
                            existingInNorm.customer_type = 'REJECTED';
                        } else if (b.status === 'PENDING') {
                            existingInNorm.status = 'PENDING';
                            existingInNorm.connection_status = 'PENDING';
                            existingInNorm.customer_type = 'PENDING';
                        }
                    } else if (isTarget || b.status === 'PENDING') {
                        b2bRequests.push({
                            id: `b2b_${b.id}`,
                            b2b_connection_id: b.id,
                            is_b2b_request: true,
                            customer_code: `B2B-${b.id}`,
                            name: otherName || 'Cliks Partner',
                            business_name: otherName || 'Cliks Partner',
                            email: otherEmail,
                            phone: '',
                            customer_type: b.status,
                            status: b.status === 'ACCEPTED' ? 'Connected' : (b.status === 'REJECTED' ? 'Rejected' : 'PENDING'),
                            connection_status: b.status === 'ACCEPTED' ? 'CONNECTED' : b.status,
                            connection_type: 'Supplier Connection Request',
                            request_date: b.created_at ? b.created_at.split('T')[0] : '',
                            created_at: b.created_at,
                            current_balance: 0,
                            outstanding_balance: 0
                        });
                    }
                });
            } catch (b2bErr) {
                console.warn('[Customer Controller] B2B request merge warning:', b2bErr.message);
            }

            const combinedList = [...b2bRequests, ...normalized];

            return sendSuccess(res, {
                customers: combinedList,
                pagination: {
                    total: combinedList.length,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages: Math.ceil(combinedList.length / parseInt(limit))
                }
            }, 'Customers fetched successfully');
        } catch (error) {
            console.error('[Customer Controller Error]', error);
            return sendError(res, 'Failed to fetch customers', 500);
        }
    },

    getCustomerById: async (req, res) => {
        try {
            const { id } = req.params;
            const customer = await db.prepare('SELECT * FROM business_customers WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!customer) {
                return sendError(res, 'Customer not found', 404);
            }
            const phoneVal = customer.phone_number || customer.phone || '';
            const panVal = customer.pan_number || customer.pan || '';
            const addrVal = customer.billing_address || customer.address || '';
            const normalized = {
                ...customer,
                phone: phoneVal,
                phone_number: phoneVal,
                pan: panVal,
                pan_number: panVal,
                address: addrVal,
                billing_address: addrVal
            };
            return sendSuccess(res, normalized, 'Customer fetched successfully');
        } catch (error) {
            return sendError(res, 'Failed to fetch customer details', 500);
        }
    },

    createCustomer: async (req, res) => {
        try {
            console.log("=== CREATE CUSTOMER REQUEST ===");
            console.log("Request Body:", JSON.stringify(req.body, null, 2));

            // Self-healing column checks
            const alters = [
                'ALTER TABLE business_customers ADD COLUMN phone_number TEXT',
                'ALTER TABLE business_customers ADD COLUMN pan_number TEXT',
                'ALTER TABLE business_customers ADD COLUMN billing_address TEXT',
                'ALTER TABLE business_customers ADD COLUMN alternate_phone TEXT',
                'ALTER TABLE business_customers ADD COLUMN current_balance REAL DEFAULT 0'
            ];
            for (const sql of alters) {
                try { await db.prepare(sql).run(); } catch (e) {}
            }

            const userId = req.user.id;
            const body = req.body || {};

            const name = body.name || body.customer_name || body.contact_person;
            if (!name || !String(name).trim()) {
                return sendError(res, 'Customer name is required', 400);
            }

            // Global Field Validations
            const phoneErr = validatePhone(body.phone_number || body.phone || body.mobile || body.contact, true);
            if (phoneErr) return sendError(res, phoneErr, 400);

            if (body.email) {
                const emailErr = validateEmail(body.email, false);
                if (emailErr) return sendError(res, emailErr, 400);
            }

            if (body.gstin) {
                const gstinErr = validateGstin(body.gstin, false);
                if (gstinErr) return sendError(res, gstinErr, 400);
            }

            if (body.pan || body.pan_number) {
                const panErr = validatePan(body.pan || body.pan_number, false);
                if (panErr) return sendError(res, panErr, 400);
            }

            const rawPhone = (body.phone_number || body.phone || body.mobile || body.contact || '').toString().trim();
            const rawEmail = (body.email || '').toString().trim().toLowerCase();
            const rawGstin = (body.gstin || '').toString().trim().toUpperCase();
            const rawPan = (body.pan_number || body.pan || '').toString().trim().toUpperCase();

            const company = body.company || body.business_name || null;
            const business_name = body.business_name || company || null;
            const contact_person = body.contact_person || name || null;
            const gstin = rawGstin || null;
            const panVal = body.pan_number || body.pan || null;
            const pan = panVal;
            const pan_number = panVal;
            const email = rawEmail || null;
            const phoneVal = rawPhone || null;
            const phone = phoneVal;
            const phone_number = phoneVal;
            const alternate_phone = body.alternate_phone || null;
            const website = body.website || null;
            const customer_type = body.customer_type || null;
            const tax_type = body.tax_type || null;
            const place_of_supply = body.place_of_supply || null;
            const addrVal = body.billing_address || body.address || null;
            const address = addrVal;
            const billing_address = addrVal;
            const shipping_address = body.shipping_address || null;
            const city = body.city || null;
            const state = body.state || null;
            const country = body.country || 'India';
            const pincode = body.pincode || null;
            const opening_balance = parseFloat(body.opening_balance || body.openingBalance) || 0;
            const credit_limit = parseFloat(body.credit_limit || body.creditLimit) || 0;
            const status = body.status || 'Active';
            const customer_code = body.customer_code || `CUST-${Date.now().toString().slice(-4)}`;
            const due_days = parseInt(body.due_days) || 30;
            const notes = body.notes || null;
            const preferred_contact = body.preferred_contact || 'WhatsApp';
            const reminder_enabled = body.reminder_enabled !== undefined ? (body.reminder_enabled ? 1 : 0) : 1;
            const loyalty_points = parseInt(body.loyalty_points) || 0;
            const now = new Date().toISOString();

            const sql = `
                INSERT INTO business_customers (
                    user_id, name, company, business_name, contact_person, gstin, pan, pan_number, email, phone, phone_number,
                    alternate_phone, website, customer_type, tax_type, place_of_supply, address, billing_address,
                    shipping_address, city, state, country, pincode, opening_balance, credit_limit, 
                    status, customer_code, due_days, notes, preferred_contact, reminder_enabled, 
                    loyalty_points, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            const params = [
                userId, name, company, business_name, contact_person, gstin, pan, pan_number, email, phone, phone_number,
                alternate_phone, website, customer_type, tax_type, place_of_supply, address, billing_address,
                shipping_address, city, state, country, pincode, opening_balance, credit_limit,
                status, customer_code, due_days, notes, preferred_contact, reminder_enabled,
                loyalty_points, now, now
            ];

            const result = await db.prepare(sql).run(...params);
            const newCustomer = await db.prepare('SELECT * FROM business_customers WHERE id = ?').get(result.lastInsertRowid);
            
            // Sync connection request if email belongs to a CLIKS Website user
            if (email) {
                await connectionService.syncCustomerConnectionOnCreateOrUpdate({
                    business_id: userId,
                    business_customer_id: newCustomer.id,
                    customer_email: email
                });
            }

            const connStatus = await connectionService.getCustomerConnectionStatus(userId, newCustomer.id, email);

            const normalized = {
                ...newCustomer,
                phone: phoneVal,
                phone_number: phoneVal,
                pan: panVal,
                pan_number: panVal,
                address: addrVal,
                billing_address: addrVal,
                connection_status: connStatus,
                connectionStatus: connStatus
            };

            await logAuditEvent(req, {
                action: 'Create Customer',
                module: 'Customers',
                recordId: newCustomer.id,
                newValue: normalized,
                details: `Created customer "${name}"`
            });

            return sendSuccess(res, normalized, 'Customer created successfully', 201);
        } catch (err) {
            console.error("CREATE CUSTOMER ERROR:", err);
            return res.status(500).json({
                success: false,
                message: err.message,
                stack: err.stack
            });
        }
    },

    updateCustomer: async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.user.id;
            const body = req.body || {};

            let existing = await db.prepare('SELECT * FROM business_customers WHERE id = ? AND user_id = ?').get(id, userId);

            if (!existing) {
                // Fallback lookup by email or phone for this merchant to prevent 404 on ID mismatch
                const inputEmail = body.email || body.client_email || body.customer_email || '';
                const inputPhone = body.phone_number !== undefined ? body.phone_number : (body.phone !== undefined ? body.phone : body.mobile);

                if (inputEmail || inputPhone) {
                    existing = await db.prepare(`
                        SELECT * FROM business_customers 
                        WHERE user_id = ? 
                          AND (
                              (email IS NOT NULL AND LOWER(email) = LOWER(?))
                              OR (phone IS NOT NULL AND phone = ?)
                          )
                        ORDER BY id DESC LIMIT 1
                    `).get(userId, inputEmail, inputPhone || '');
                }
            }

            if (!existing) {
                // If customer is still not found, auto-create customer record for this merchant
                const nameVal = body.name || body.client_name || body.customer_name || (body.email ? body.email.split('@')[0] : 'Customer');
                const emailVal = body.email || body.client_email || null;
                const phoneVal = body.phone_number || body.phone || body.mobile || null;
                const ptsVal = body.loyalty_points || 0;
                const now = new Date().toISOString();

                try {
                    const insRes = await db.prepare(`
                        INSERT INTO business_customers (user_id, name, email, phone, phone_number, loyalty_points, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `).run(userId, nameVal, emailVal, phoneVal, phoneVal, ptsVal, now, now);
                    existing = await db.prepare('SELECT * FROM business_customers WHERE id = ?').get(insRes.lastInsertRowid);
                } catch (insErr) {}
            }

            const updates = [];
            const params = [];

            const inputPhone = body.phone_number !== undefined ? body.phone_number : (body.phone !== undefined ? body.phone : body.mobile);
            if (inputPhone !== undefined) {
                updates.push('phone = ?');
                params.push(inputPhone);
                updates.push('phone_number = ?');
                params.push(inputPhone);
            }

            const inputPan = body.pan_number !== undefined ? body.pan_number : body.pan;
            if (inputPan !== undefined) {
                updates.push('pan = ?');
                params.push(inputPan);
                updates.push('pan_number = ?');
                params.push(inputPan);
            }

            const inputAddr = body.billing_address !== undefined ? body.billing_address : body.address;
            if (inputAddr !== undefined) {
                updates.push('address = ?');
                params.push(inputAddr);
                updates.push('billing_address = ?');
                params.push(inputAddr);
            }

            if (body.alternate_phone !== undefined) { updates.push('alternate_phone = ?'); params.push(body.alternate_phone); }
            if (body.name !== undefined) { updates.push('name = ?'); params.push(body.name); }
            if (body.email !== undefined) { updates.push('email = ?'); params.push(body.email); }
            if (body.company !== undefined) { updates.push('company = ?'); params.push(body.company); }
            if (body.business_name !== undefined) { updates.push('business_name = ?'); params.push(body.business_name); }
            if (body.contact_person !== undefined) { updates.push('contact_person = ?'); params.push(body.contact_person); }
            if (body.gstin !== undefined) { updates.push('gstin = ?'); params.push(body.gstin); }
            if (body.website !== undefined) { updates.push('website = ?'); params.push(body.website); }
            if (body.customer_type !== undefined) { updates.push('customer_type = ?'); params.push(body.customer_type); }
            if (body.tax_type !== undefined) { updates.push('tax_type = ?'); params.push(body.tax_type); }
            if (body.place_of_supply !== undefined) { updates.push('place_of_supply = ?'); params.push(body.place_of_supply); }
            if (body.shipping_address !== undefined) { updates.push('shipping_address = ?'); params.push(body.shipping_address); }
            if (body.city !== undefined) { updates.push('city = ?'); params.push(body.city); }
            if (body.state !== undefined) { updates.push('state = ?'); params.push(body.state); }
            if (body.pincode !== undefined) { updates.push('pincode = ?'); params.push(body.pincode); }
            if (body.opening_balance !== undefined || body.openingBalance !== undefined) { updates.push('opening_balance = ?'); params.push(parseFloat(body.opening_balance !== undefined ? body.opening_balance : body.openingBalance)); }
            if (body.credit_limit !== undefined || body.creditLimit !== undefined) { updates.push('credit_limit = ?'); params.push(parseFloat(body.credit_limit !== undefined ? body.credit_limit : body.creditLimit)); }
            if (body.status !== undefined) { updates.push('status = ?'); params.push(body.status); }
            if (body.due_days !== undefined) { updates.push('due_days = ?'); params.push(parseInt(body.due_days)); }
            if (body.notes !== undefined) { updates.push('notes = ?'); params.push(body.notes); }
            if (body.preferred_contact !== undefined) { updates.push('preferred_contact = ?'); params.push(body.preferred_contact); }
            if (body.reminder_enabled !== undefined) { updates.push('reminder_enabled = ?'); params.push(body.reminder_enabled ? 1 : 0); }
            if (body.loyalty_points !== undefined) { updates.push('loyalty_points = ?'); params.push(parseInt(body.loyalty_points)); }
            if (body.total_spent !== undefined) { updates.push('total_spent = ?'); params.push(parseFloat(body.total_spent)); }

            if (updates.length === 0) return sendError(res, 'No fields to update', 400);

            updates.push('updated_at = ?');
            params.push(new Date().toISOString());
            params.push(existing.id, userId);

            await db.prepare(`
                UPDATE business_customers SET ${updates.join(', ')}
                WHERE id = ? AND user_id = ?
            `).run(...params);

            const updated = await db.prepare('SELECT * FROM business_customers WHERE id = ?').get(existing.id);
            if (updated && updated.email) {
                try {
                    await connectionService.syncCustomerConnectionOnCreateOrUpdate({
                        business_id: userId,
                        business_customer_id: updated.id,
                        customer_email: updated.email
                    });
                } catch (syncErr) {}
            }

            const connStatus = updated ? await connectionService.getCustomerConnectionStatus(userId, updated.id, updated.email) : { status: 'none', is_connected: false };

            const phoneVal = updated.phone_number || updated.phone || '';
            const panVal = updated.pan_number || updated.pan || '';
            const addrVal = updated.billing_address || updated.address || '';
            const normalized = {
                ...updated,
                phone: phoneVal,
                phone_number: phoneVal,
                pan: panVal,
                pan_number: panVal,
                address: addrVal,
                billing_address: addrVal,
                connection_status: connStatus,
                connectionStatus: connStatus
            };

            await logAuditEvent(req, {
                action: 'Update Customer',
                module: 'Customers',
                recordId: id,
                oldValue: existing,
                newValue: normalized,
                details: `Updated customer "${updated.name}"`
            });

            return sendSuccess(res, normalized, 'Customer updated successfully');
        } catch (error) {
            console.error('[Update Customer Error]', error);
            return sendError(res, 'Failed to update customer', 500);
        }
    },

    deleteCustomer: async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.user.id;

            console.log(`[Delete Customer Debug] Attempting delete for ID: ${id}, User ID: ${userId}`);

            const idStr = String(id).trim();
            const cleanIdStr = idStr.replace(/^(b2b|cust)_/i, '').trim();
            const numId = (!isNaN(Number(cleanIdStr)) && cleanIdStr !== '') ? Number(cleanIdStr) : null;

            let existing = null;

            // 1. Try finding by integer ID in business_customers
            if (numId !== null) {
                try {
                    existing = await db.prepare('SELECT * FROM business_customers WHERE id = ? AND user_id = ?').get(numId, userId);
                } catch (e) {}
            }

            // 2. Try finding by text email if non-numeric string
            if (!existing && isNaN(Number(idStr))) {
                try {
                    existing = await db.prepare('SELECT * FROM business_customers WHERE user_id = ? AND LOWER(email) = ?').get(userId, idStr.toLowerCase());
                } catch (e) {}
            }

            // 3. Delete from customer_connections & b2b_supplier_connections if B2B ID or connection present
            try {
                if (numId !== null) {
                    await db.prepare('DELETE FROM customer_connections WHERE (id = ? OR business_customer_id = ?) AND business_id = ?').run(numId, numId, userId);
                    await db.prepare('DELETE FROM b2b_supplier_connections WHERE (id = ? OR target_user_id = ? OR source_user_id = ?) AND (source_user_id = ? OR target_user_id = ?)').run(numId, numId, numId, userId, userId);
                }
            } catch (connErr) {}

            // 4. Delete from business_customers if found
            if (existing) {
                await db.prepare('DELETE FROM business_customers WHERE id = ? AND user_id = ?').run(existing.id, userId);

                try {
                    await logAuditEvent(req, {
                        action: 'Delete Customer',
                        module: 'Customers',
                        recordId: existing.id,
                        oldValue: existing,
                        details: `Deleted customer "${existing.name}"`
                    });
                } catch (e) {}

                return sendSuccess(res, { id: existing.id }, 'Customer deleted successfully');
            }

            // If it was a B2B connection ID (e.g. b2b_9) or already removed
            return sendSuccess(res, { id }, 'Customer connection deleted successfully');
        } catch (error) {
            console.error('[Delete Customer Error]', error);
            return sendError(res, 'Failed to delete customer', 500);
        }
    },

    respondB2BConnection: async (req, res) => {
        try {
            const b2bConnectionService = require('../utils/b2bConnectionService');
            const { connection_id, action } = req.body;
            if (!connection_id || !action) {
                return sendError(res, 'connection_id and action are required', 400);
            }

            const updated = await b2bConnectionService.respondToConnection({
                user_id: req.user.id,
                connection_id: parseInt(connection_id),
                action
            });

            return sendSuccess(res, updated, `B2B connection request ${action}ed successfully`);
        } catch (error) {
            console.error('[B2B Respond Error]', error);
            return sendError(res, error.message || 'Failed to respond to connection request', error.statusCode || 500);
        }
    }
};

module.exports = customerController;
