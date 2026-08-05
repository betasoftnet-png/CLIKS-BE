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
            return sendSuccess(res, customers, 'Customers fetched successfully');
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
            const phone = body.phone || body.phone_number || null;
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
                    user_id, name, company, business_name, contact_person, gstin, pan, email, phone, 
                    alternate_phone, website, customer_type, tax_type, place_of_supply, address, 
                    shipping_address, city, state, country, pincode, opening_balance, credit_limit, 
                    status, customer_code, due_days, notes, preferred_contact, reminder_enabled, 
                    loyalty_points, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            const params = [
                userId, name, company, business_name, contact_person, gstin, pan, email, phone,
                alternate_phone, website, customer_type, tax_type, place_of_supply, address,
                shipping_address, city, state, country, pincode, opening_balance, credit_limit,
                status, customer_code, due_days, notes, preferred_contact, reminder_enabled,
                loyalty_points, now, now
            ];

            console.log("SQL Query:", sql);
            console.log("SQL Parameters:", params);

            const result = await db.prepare(sql).run(...params);
            const newCustomer = await db.prepare('SELECT * FROM business_customers WHERE id = ?').get(result.lastInsertRowid);

            return sendSuccess(res, newCustomer, 'Customer created successfully', 201);
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
        const { name, email, phone, company, status, notes, total_spent } = req.body;

        try {
            // Verify ownership
            const existing = await db.prepare('SELECT * FROM business_customers WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!existing) return sendError(res, 'Customer not found or access denied', 404);

            const updates = [];
            const params = [];

            if (name !== undefined) { updates.push('name = ?'); params.push(name); }
            if (email !== undefined) { updates.push('email = ?'); params.push(email); }
            if (phone !== undefined) { updates.push('phone = ?'); params.push(phone); }
            if (company !== undefined) { updates.push('company = ?'); params.push(company); }
            if (status !== undefined) { updates.push('status = ?'); params.push(status); }
            if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
            if (total_spent !== undefined) { updates.push('total_spent = ?'); params.push(total_spent); }

            if (updates.length === 0) return sendError(res, 'No fields to update', 400);

            updates.push('updated_at = ?');
            params.push(new Date().toISOString());
            params.push(id, req.user.id);

            await db.prepare(`
                UPDATE business_customers SET ${updates.join(', ')}
                WHERE id = ? AND user_id = ?
            `).run(...params);

            const updated = await db.prepare('SELECT * FROM business_customers WHERE id = ?').get(id);
            return sendSuccess(res, updated, 'Customer updated successfully');
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
