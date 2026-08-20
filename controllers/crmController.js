const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const connectionService = require('../utils/connectionService');

/**
 * CRM Controller
 */
const crmController = {
    // Get all customers for the business
    getCustomers: async (req, res) => {
        try {
            const userId = req.user.id;
            await connectionService.ensureTable();

            const customers = await db.prepare('SELECT * FROM business_customers WHERE user_id = ? ORDER BY created_at DESC').all(userId);
            if (!customers || customers.length === 0) {
                return sendSuccess(res, [], 'Customers fetched successfully');
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

            // Batch aggregate sales by email & name
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

                return {
                    ...c,
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

            // Sort customers by total_sales DESC so top customers appear first
            normalized.sort((a, b) => b.total_sales - a.total_sales);

            return sendSuccess(res, normalized, 'Customers fetched successfully');
        } catch (error) {
            console.error('[CRM Controller] Error fetching customers:', error);
            return sendError(res, 'Failed to fetch customers', 500);
        }
    },

    // Create a new customer
    createCustomer: async (req, res) => {
        try {
            console.log("=== CREATE CUSTOMER (CRM) REQUEST ===");
            console.log("Request Body:", JSON.stringify(req.body, null, 2));

            // Self-healing DB check for columns
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

            // Phone validation: exactly 10 digits
            const rawPhone = (body.phone_number || body.phone || body.mobile || body.contact || '').toString().trim();
            if (!rawPhone || !/^\d{10}$/.test(rawPhone)) {
                return sendError(res, 'Phone number must be exactly 10 digits.', 400);
            }

            // Email validation: optional, but if entered must end with @bnxmail.com
            const rawEmail = (body.email || '').toString().trim().toLowerCase();
            if (rawEmail.length > 0 && (!rawEmail.endsWith('@bnxmail.com') || !/^[^\s@]+@bnxmail\.com$/.test(rawEmail))) {
                return sendError(res, 'Email must use the @bnxmail.com domain.', 400);
            }

            // GSTIN validation: optional, but if entered must be exactly 15 chars
            const rawGstin = (body.gstin || '').toString().trim().toUpperCase();
            if (rawGstin.length > 0 && (rawGstin.length !== 15 || !/^[0-9A-Z]{15}$/.test(rawGstin))) {
                return sendError(res, 'GSTIN must be exactly 15 characters.', 400);
            }

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

    // Update customer details
    updateCustomer: async (req, res) => {
        const { id } = req.params;
        const body = req.body || {};

        try {
            // Verify ownership
            const existing = await db.prepare('SELECT * FROM business_customers WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!existing) return sendError(res, 'Customer not found or access denied', 404);

            const updates = [];
            const params = [];

            // Phone number update handling
            const inputPhone = body.phone_number !== undefined ? body.phone_number : (body.phone !== undefined ? body.phone : body.mobile);
            if (inputPhone !== undefined) {
                updates.push('phone = ?');
                params.push(inputPhone);
                updates.push('phone_number = ?');
                params.push(inputPhone);
            }

            // PAN number update handling
            const inputPan = body.pan_number !== undefined ? body.pan_number : body.pan;
            if (inputPan !== undefined) {
                updates.push('pan = ?');
                params.push(inputPan);
                updates.push('pan_number = ?');
                params.push(inputPan);
            }

            // Billing address update handling
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
            if (body.opening_balance !== undefined) { updates.push('opening_balance = ?'); params.push(parseFloat(body.opening_balance)); }
            if (body.credit_limit !== undefined) { updates.push('credit_limit = ?'); params.push(parseFloat(body.credit_limit)); }
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
            params.push(id, req.user.id);

            await db.prepare(`
                UPDATE business_customers SET ${updates.join(', ')}
                WHERE id = ? AND user_id = ?
            `).run(...params);

            const updated = await db.prepare('SELECT * FROM business_customers WHERE id = ?').get(id);
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
                billing_address: addrVal
            };
            return sendSuccess(res, normalized, 'Customer updated successfully');
        } catch (error) {
            console.error('[CRM Controller] Error updating customer:', error);
            return sendError(res, 'Failed to update customer', 500);
        }
    },

    // Delete a customer
    deleteCustomer: async (req, res) => {
        const { id } = req.params;
        const userId = req.user.id;

        try {
            console.log(`[CRM Delete Customer Debug] Attempting delete for ID: ${id}, User ID: ${userId}`);

            const idStr = String(id).trim();
            const cleanIdStr = idStr.replace(/^(b2b|cust)_/i, '').trim();
            const numId = (!isNaN(Number(cleanIdStr)) && cleanIdStr !== '') ? Number(cleanIdStr) : null;

            let existing = null;
            if (numId !== null) {
                try { existing = await db.prepare('SELECT * FROM business_customers WHERE id = ? AND user_id = ?').get(numId, userId); } catch (e) {}
            }

            try {
                if (numId !== null) {
                    await db.prepare('DELETE FROM customer_connections WHERE (id = ? OR business_customer_id = ?) AND business_id = ?').run(numId, numId, userId);
                    await db.prepare('DELETE FROM b2b_supplier_connections WHERE (id = ? OR target_user_id = ? OR source_user_id = ?) AND (source_user_id = ? OR target_user_id = ?)').run(numId, numId, numId, userId, userId);
                }
            } catch (connErr) {}

            if (existing) {
                await db.prepare('DELETE FROM business_customers WHERE id = ? AND user_id = ?').run(existing.id, userId);
                return sendSuccess(res, { id: existing.id }, 'Customer deleted successfully');
            }

            return sendSuccess(res, { id }, 'Customer deleted successfully');
        } catch (error) {
            console.error('[CRM Controller] Error deleting customer:', error);
            return sendError(res, 'Failed to delete customer', 500);
        }
    }
};

module.exports = crmController;
