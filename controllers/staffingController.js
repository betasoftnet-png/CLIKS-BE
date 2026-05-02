const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

/**
 * Staffing Controller
 */
const staffingController = {
    // Get all employees for the business
    getEmployees: async (req, res) => {
        try {
            const employees = await db.prepare('SELECT * FROM business_employees WHERE user_id = ? ORDER BY hire_date DESC').all(req.user.id);
            return sendSuccess(res, employees, 'Employees fetched successfully');
        } catch (error) {
            console.error('[Staffing Controller] Error fetching employees:', error);
            return sendError(res, 'Failed to fetch employees', 500);
        }
    },

    // Create a new employee
    createEmployee: async (req, res) => {
        const { name, role, email, phone, salary, status, hire_date } = req.body;
        if (!name) return sendError(res, 'Name is required', 400);

        try {
            const now = new Date().toISOString();
            const result = await db.prepare(`
                INSERT INTO business_employees (user_id, name, role, email, phone, salary, status, hire_date, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                req.user.id, 
                name, 
                role || null, 
                email || null, 
                phone || null, 
                salary || 0, 
                status || 'active', 
                hire_date || new Date().toISOString().split('T')[0], 
                now, 
                now
            );

            const newEmployee = await db.prepare('SELECT * FROM business_employees WHERE id = ?').get(result.lastInsertRowid);
            return sendSuccess(res, newEmployee, 'Employee added successfully', 201);
        } catch (error) {
            console.error('[Staffing Controller] Error creating employee:', error);
            return sendError(res, 'Failed to create employee', 500);
        }
    },

    // Update employee details
    updateEmployee: async (req, res) => {
        const { id } = req.params;
        const { name, role, email, phone, salary, status, hire_date } = req.body;

        try {
            const existing = await db.prepare('SELECT * FROM business_employees WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!existing) return sendError(res, 'Employee not found or access denied', 404);

            const updates = [];
            const params = [];

            if (name !== undefined) { updates.push('name = ?'); params.push(name); }
            if (role !== undefined) { updates.push('role = ?'); params.push(role); }
            if (email !== undefined) { updates.push('email = ?'); params.push(email); }
            if (phone !== undefined) { updates.push('phone = ?'); params.push(phone); }
            if (salary !== undefined) { updates.push('salary = ?'); params.push(salary); }
            if (status !== undefined) { updates.push('status = ?'); params.push(status); }
            if (hire_date !== undefined) { updates.push('hire_date = ?'); params.push(hire_date); }

            if (updates.length === 0) return sendError(res, 'No fields to update', 400);

            updates.push('updated_at = ?');
            params.push(new Date().toISOString());
            params.push(id, req.user.id);

            await db.prepare(`
                UPDATE business_employees SET ${updates.join(', ')}
                WHERE id = ? AND user_id = ?
            `).run(...params);

            const updated = await db.prepare('SELECT * FROM business_employees WHERE id = ?').get(id);
            return sendSuccess(res, updated, 'Employee updated successfully');
        } catch (error) {
            console.error('[Staffing Controller] Error updating employee:', error);
            return sendError(res, 'Failed to update employee', 500);
        }
    },

    // Delete an employee
    deleteEmployee: async (req, res) => {
        const { id } = req.params;
        try {
            const result = await db.prepare('DELETE FROM business_employees WHERE id = ? AND user_id = ?').run(id, req.user.id);
            if (result.changes === 0) return sendError(res, 'Employee not found or access denied', 404);
            return sendSuccess(res, null, 'Employee deleted successfully');
        } catch (error) {
            console.error('[Staffing Controller] Error deleting employee:', error);
            return sendError(res, 'Failed to delete employee', 500);
        }
    }
};

module.exports = staffingController;
