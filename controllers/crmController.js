const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

/**
 * CRM Controller
 */
const crmController = {
    // Get all customers for the business
    getCustomers: async (req, res) => {
        try {
            const customers = await db.prepare('SELECT * FROM business_customers WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
            const normalized = (customers || []).map(c => {
                const phoneVal = c.phone_number || c.phone || '';
                return {
                    ...c,
                    phone: phoneVal,
                    phone_number: phoneVal
                };
            });
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

            // Self-healing DB check for phone_number & alternate_phone columns
            const alters = [
                'ALTER TABLE business_customers ADD COLUMN phone_number TEXT',
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

            const company = body.company || body.business_name || null;
            const business_name = body.business_name || company || null;
            const contact_person = body.contact_person || name || null;
            const gstin = body.gstin || null;
            const pan = body.pan || body.pan_number || null;
            const email = body.email || null;
            const phoneVal = body.phone_number || body.phone || body.mobile || body.contact || null;
            const phone = phoneVal;
            const phone_number = phoneVal;
            const alternate_phone = body.alternate_phone || null;
            const website = body.website || null;
            const customer_type = body.customer_type || null;
            const tax_type = body.tax_type || null;
            const place_of_supply = body.place_of_supply || null;
            const address = body.address || body.billing_address || null;
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
                    user_id, name, company, business_name, contact_person, gstin, pan, email, phone, phone_number,
                    alternate_phone, website, customer_type, tax_type, place_of_supply, address, 
                    shipping_address, city, state, country, pincode, opening_balance, credit_limit, 
                    status, customer_code, due_days, notes, preferred_contact, reminder_enabled, 
                    loyalty_points, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            const params = [
                userId, name, company, business_name, contact_person, gstin, pan, email, phone, phone_number,
                alternate_phone, website, customer_type, tax_type, place_of_supply, address,
                shipping_address, city, state, country, pincode, opening_balance, credit_limit,
                status, customer_code, due_days, notes, preferred_contact, reminder_enabled,
                loyalty_points, now, now
            ];

            const result = await db.prepare(sql).run(...params);
            const newCustomer = await db.prepare('SELECT * FROM business_customers WHERE id = ?').get(result.lastInsertRowid);

            const normalized = {
                ...newCustomer,
                phone: phoneVal,
                phone_number: phoneVal
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

            // Phone number update handling (supports phone, phone_number, mobile)
            const inputPhone = body.phone_number !== undefined ? body.phone_number : (body.phone !== undefined ? body.phone : body.mobile);
            if (inputPhone !== undefined) {
                updates.push('phone = ?');
                params.push(inputPhone);
                updates.push('phone_number = ?');
                params.push(inputPhone);
            }

            if (body.alternate_phone !== undefined) { updates.push('alternate_phone = ?'); params.push(body.alternate_phone); }
            if (body.name !== undefined) { updates.push('name = ?'); params.push(body.name); }
            if (body.email !== undefined) { updates.push('email = ?'); params.push(body.email); }
            if (body.company !== undefined) { updates.push('company = ?'); params.push(body.company); }
            if (body.business_name !== undefined) { updates.push('business_name = ?'); params.push(body.business_name); }
            if (body.contact_person !== undefined) { updates.push('contact_person = ?'); params.push(body.contact_person); }
            if (body.gstin !== undefined) { updates.push('gstin = ?'); params.push(body.gstin); }
            if (body.pan !== undefined || body.pan_number !== undefined) { updates.push('pan = ?'); params.push(body.pan !== undefined ? body.pan : body.pan_number); }
            if (body.website !== undefined) { updates.push('website = ?'); params.push(body.website); }
            if (body.customer_type !== undefined) { updates.push('customer_type = ?'); params.push(body.customer_type); }
            if (body.tax_type !== undefined) { updates.push('tax_type = ?'); params.push(body.tax_type); }
            if (body.place_of_supply !== undefined) { updates.push('place_of_supply = ?'); params.push(body.place_of_supply); }
            if (body.address !== undefined || body.billing_address !== undefined) { updates.push('address = ?'); params.push(body.address !== undefined ? body.address : body.billing_address); }
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
            const normalized = {
                ...updated,
                phone: phoneVal,
                phone_number: phoneVal
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
        try {
            const result = await db.prepare('DELETE FROM business_customers WHERE id = ? AND user_id = ?').run(id, req.user.id);
            if (result.changes === 0) return sendError(res, 'Customer not found or access denied', 404);
            return sendSuccess(res, null, 'Customer deleted successfully');
        } catch (error) {
            console.error('[CRM Controller] Error deleting customer:', error);
            return sendError(res, 'Failed to delete customer', 500);
        }
    }
};

module.exports = crmController;
