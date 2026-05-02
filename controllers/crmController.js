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
        const { name, email, phone, company, status, notes } = req.body;
        if (!name) return sendError(res, 'Name is required', 400);

        try {
            const now = new Date().toISOString();
            const result = await db.prepare(`
                INSERT INTO business_customers (user_id, name, email, phone, company, status, notes, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(req.user.id, name, email || null, phone || null, company || null, status || 'lead', notes || null, now, now);

            const newCustomer = await db.prepare('SELECT * FROM business_customers WHERE id = ?').get(result.lastInsertRowid);
            return sendSuccess(res, newCustomer, 'Customer created successfully', 201);
        } catch (error) {
            console.error('[CRM Controller] Error creating customer:', error);
            return sendError(res, 'Failed to create customer', 500);
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
