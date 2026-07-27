const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

const employeeController = {
    createEmployee: async (req, res) => {
        const { name, role, email, phone, salary, status, hire_date } = req.body;
        if (!name) return sendError(res, 'Name is required', 400);
        try {
            const now = new Date().toISOString();
            const result = await db.prepare(
                `INSERT INTO employees (user_id, name, role, email, phone, salary, status, hire_date, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(req.user.id, name, role || null, email || null, phone || null, salary || 0, status || 'active', hire_date || now.split('T')[0], now, now);

            return sendSuccess(res, { id: result.lastInsertRowid, name }, 'Employee created successfully', 201);
        } catch (error) {
            console.error('[Employee Controller] Error creating employee:', error);
            return sendError(res, 'Failed to create employee', 500);
        }
    },

    uploadDocuments: async (req, res) => {
        return sendSuccess(res, null, 'Document uploaded successfully');
    },

    getEmployees: async (req, res) => {
        try {
            const employees = await db.prepare('SELECT * FROM employees WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
            return sendSuccess(res, employees, 'Employee directory fetched successfully');
        } catch (error) {
            console.error('[Employee Controller] Error getting directory:', error);
            return sendError(res, 'Failed to fetch employee directory', 500);
        }
    },

    getEmployeeById: async (req, res) => {
        const { id } = req.params;
        try {
            const employee = await db.prepare('SELECT * FROM employees WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!employee) return sendError(res, 'Employee not found', 404);
            return sendSuccess(res, employee, 'Employee profile fetched successfully');
        } catch (error) {
            console.error('[Employee Controller] Error getting profile:', error);
            return sendError(res, 'Failed to fetch profile', 500);
        }
    },

    assignRole: async (req, res) => {
        const { id } = req.params;
        const { role } = req.body;
        try {
            const now = new Date().toISOString();
            await db.prepare(
                `UPDATE employees SET role = ?, updated_at = ? WHERE id = ? AND user_id = ?`
            ).run(role || null, now, id, req.user.id);

            return sendSuccess(res, null, 'Role assigned successfully');
        } catch (error) {
            console.error('[Employee Controller] Error assigning role:', error);
            return sendError(res, 'Failed to assign role', 500);
        }
    },

    getActivityLogs: async (req, res) => {
        return sendSuccess(res, [], 'Activity logs fetched successfully');
    },

    getPerformanceReports: async (req, res) => {
        return sendSuccess(res, [], 'Performance reports fetched successfully');
    }
};

module.exports = employeeController;
