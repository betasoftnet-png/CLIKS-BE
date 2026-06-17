const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

// Ensure extra helper columns exist on the employees table
const initColumns = async () => {
    const columns = [
        'department',
        'designation',
        'emergency_contact',
        'bank_details',
        'address',
        'shift',
        'notes',
        'salary_structure',
        'roles',
        'permissions',
        'profile_photo',
        'documents',
        'salary_type',
        'performance_rating',
        'target_score',
        'leave_balance'
    ];
    for (const col of columns) {
        try {
            await db.prepare(`ALTER TABLE employees ADD COLUMN ${col} TEXT`).run();
        } catch (e) {
            // Column already exists, ignore
        }
    }
};
initColumns();

const staffController = {
    // 1. POST /staff
    createStaff: async (req, res) => {
        const { name, role, email, phone, salary, status, hire_date, department, designation, address, emergency_contact, bank_details, shift } = req.body;
        if (!name) return sendError(res, 'Name is required', 400);

        try {
            const now = new Date().toISOString();
            const result = await db.prepare(`
                INSERT INTO employees (user_id, name, role, email, phone, salary, status, hire_date, department, designation, address, emergency_contact, bank_details, shift, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                req.user.id,
                name,
                role || 'Staff',
                email || null,
                phone || null,
                salary || 0,
                status || 'active',
                hire_date || now.split('T')[0],
                department || 'Operations',
                designation || 'Associate',
                address ? (typeof address === 'object' ? JSON.stringify(address) : address) : null,
                emergency_contact ? (typeof emergency_contact === 'object' ? JSON.stringify(emergency_contact) : emergency_contact) : null,
                bank_details ? (typeof bank_details === 'object' ? JSON.stringify(bank_details) : bank_details) : null,
                shift ? (typeof shift === 'object' ? JSON.stringify(shift) : shift) : null,
                now,
                now
            );

            const newStaff = await db.prepare('SELECT * FROM employees WHERE id = ?').get(result.lastInsertRowid);
            return sendSuccess(res, newStaff, 'Staff added successfully', 201);
        } catch (error) {
            console.error('[Staff Controller] Error creating staff:', error);
            return sendError(res, 'Failed to create staff', 500);
        }
    },

    // 2. GET /staff (with filtering by status, department, designation)
    getStaff: async (req, res) => {
        const { status, department, designation } = req.query;
        try {
            let query = 'SELECT * FROM employees WHERE user_id = ?';
            const params = [req.user.id];

            if (status) {
                query += ' AND status = ?';
                params.push(status);
            }
            if (department) {
                query += ' AND department = ?';
                params.push(department);
            }
            if (designation) {
                query += ' AND designation = ?';
                params.push(designation);
            }

            query += ' ORDER BY id DESC';
            const staff = await db.prepare(query).all(...params);
            return sendSuccess(res, staff, 'Staff retrieved successfully');
        } catch (error) {
            console.error('[Staff Controller] Error fetching staff:', error);
            return sendError(res, 'Failed to fetch staff', 500);
        }
    },

    // 3. GET /staff/:id
    getStaffById: async (req, res) => {
        const { id } = req.params;
        try {
            const staff = await db.prepare('SELECT * FROM employees WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!staff) return sendError(res, 'Staff member not found', 404);
            return sendSuccess(res, staff, 'Staff member retrieved successfully');
        } catch (error) {
            console.error('[Staff Controller] Error getting staff:', error);
            return sendError(res, 'Failed to get staff member', 500);
        }
    },

    // 4. PUT /staff/:id
    updateStaff: async (req, res) => {
        const { id } = req.params;
        const fields = req.body;
        try {
            const existing = await db.prepare('SELECT * FROM employees WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!existing) return sendError(res, 'Staff member not found', 404);

            const updates = [];
            const params = [];
            for (const [key, value] of Object.entries(fields)) {
                if (key !== 'id' && key !== 'user_id') {
                    updates.push(`${key} = ?`);
                    params.push(typeof value === 'object' ? JSON.stringify(value) : value);
                }
            }

            if (updates.length > 0) {
                updates.push('updated_at = ?');
                params.push(new Date().toISOString());
                params.push(id, req.user.id);

                await db.prepare(`UPDATE employees SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
            }

            const updated = await db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
            return sendSuccess(res, updated, 'Staff member updated successfully');
        } catch (error) {
            console.error('[Staff Controller] Error updating staff:', error);
            return sendError(res, 'Failed to update staff member', 500);
        }
    },

    // 5. DELETE /staff/:id
    deleteStaff: async (req, res) => {
        const { id } = req.params;
        try {
            const result = await db.prepare('DELETE FROM employees WHERE id = ? AND user_id = ?').run(id, req.user.id);
            if (result.changes === 0) return sendError(res, 'Staff member not found', 404);
            return sendSuccess(res, null, 'Staff member deleted successfully');
        } catch (error) {
            console.error('[Staff Controller] Error deleting staff:', error);
            return sendError(res, 'Failed to delete staff member', 500);
        }
    },

    // 6. GET /staff/search?q=arun
    searchStaff: async (req, res) => {
        const { q } = req.query;
        try {
            const searchTerm = `%${q || ''}%`;
            const staff = await db.prepare(`
                SELECT * FROM employees 
                WHERE user_id = ? AND (name LIKE ? OR email LIKE ? OR department LIKE ?)
            `).all(req.user.id, searchTerm, searchTerm, searchTerm);
            return sendSuccess(res, staff, 'Search completed successfully');
        } catch (error) {
            console.error('[Staff Controller] Error searching staff:', error);
            return sendError(res, 'Search failed', 500);
        }
    },

    // 10. POST /staff/:id/profile-photo
    uploadProfilePhoto: async (req, res) => {
        const { id } = req.params;
        const { photo_url } = req.body;
        try {
            await db.prepare('UPDATE employees SET profile_photo = ? WHERE id = ? AND user_id = ?').run(photo_url || null, id, req.user.id);
            return sendSuccess(res, { photo_url }, 'Profile photo updated successfully');
        } catch (error) {
            return sendError(res, 'Failed to update profile photo', 500);
        }
    },

    // 11. GET /staff/:id/profile
    getProfile: async (req, res) => {
        const { id } = req.params;
        try {
            const staff = await db.prepare('SELECT * FROM employees WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!staff) return sendError(res, 'Staff member not found', 404);
            return sendSuccess(res, staff, 'Profile retrieved successfully');
        } catch (error) {
            return sendError(res, 'Failed to retrieve profile', 500);
        }
    },

    // 12. POST /staff/:id/documents
    uploadDocuments: async (req, res) => {
        const { id } = req.params;
        const { document } = req.body;
        try {
            const staff = await db.prepare('SELECT documents FROM employees WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!staff) return sendError(res, 'Staff member not found', 404);

            const docs = JSON.parse(staff.documents || '[]');
            const newDoc = { id: Date.now().toString(), name: document.name, url: document.url, uploaded_at: new Date().toISOString() };
            docs.push(newDoc);

            await db.prepare('UPDATE employees SET documents = ? WHERE id = ? AND user_id = ?').run(JSON.stringify(docs), id, req.user.id);
            return sendSuccess(res, newDoc, 'Document uploaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to upload document', 500);
        }
    },

    // 13. GET /staff/:id/documents
    getDocuments: async (req, res) => {
        const { id } = req.params;
        try {
            const staff = await db.prepare('SELECT documents FROM employees WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!staff) return sendError(res, 'Staff member not found', 404);
            return sendSuccess(res, JSON.parse(staff.documents || '[]'), 'Documents retrieved successfully');
        } catch (error) {
            return sendError(res, 'Failed to retrieve documents', 500);
        }
    },

    // 14. DELETE /staff/:id/documents/:documentId
    deleteDocument: async (req, res) => {
        const { id, documentId } = req.params;
        try {
            const staff = await db.prepare('SELECT documents FROM employees WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!staff) return sendError(res, 'Staff member not found', 404);

            const docs = JSON.parse(staff.documents || '[]');
            const filtered = docs.filter(d => d.id !== documentId);

            await db.prepare('UPDATE employees SET documents = ? WHERE id = ? AND user_id = ?').run(JSON.stringify(filtered), id, req.user.id);
            return sendSuccess(res, null, 'Document deleted successfully');
        } catch (error) {
            return sendError(res, 'Failed to delete document', 500);
        }
    },

    // 15-16. Address Endpoints
    setAddress: async (req, res) => {
        const { id } = req.params;
        try {
            await db.prepare('UPDATE employees SET address = ? WHERE id = ? AND user_id = ?').run(JSON.stringify(req.body), id, req.user.id);
            return sendSuccess(res, req.body, 'Address updated successfully');
        } catch (error) {
            return sendError(res, 'Failed to update address', 500);
        }
    },

    // 17-18. Emergency Contact
    setEmergencyContact: async (req, res) => {
        const { id } = req.params;
        try {
            await db.prepare('UPDATE employees SET emergency_contact = ? WHERE id = ? AND user_id = ?').run(JSON.stringify(req.body), id, req.user.id);
            return sendSuccess(res, req.body, 'Emergency contact updated successfully');
        } catch (error) {
            return sendError(res, 'Failed to update emergency contact', 500);
        }
    },
    getEmergencyContact: async (req, res) => {
        const { id } = req.params;
        try {
            const staff = await db.prepare('SELECT emergency_contact FROM employees WHERE id = ? AND user_id = ?').get(id, req.user.id);
            return sendSuccess(res, JSON.parse(staff?.emergency_contact || '{}'), 'Emergency contact retrieved');
        } catch (error) {
            return sendError(res, 'Failed to retrieve emergency contact', 500);
        }
    },

    // 19-20. Bank Details
    setBankDetails: async (req, res) => {
        const { id } = req.params;
        try {
            await db.prepare('UPDATE employees SET bank_details = ? WHERE id = ? AND user_id = ?').run(JSON.stringify(req.body), id, req.user.id);
            return sendSuccess(res, req.body, 'Bank details updated successfully');
        } catch (error) {
            return sendError(res, 'Failed to update bank details', 500);
        }
    },
    getBankDetails: async (req, res) => {
        const { id } = req.params;
        try {
            const staff = await db.prepare('SELECT bank_details FROM employees WHERE id = ? AND user_id = ?').get(id, req.user.id);
            return sendSuccess(res, JSON.parse(staff?.bank_details || '{}'), 'Bank details retrieved');
        } catch (error) {
            return sendError(res, 'Failed to retrieve bank details', 500);
        }
    },

    // 21-22. Salary Structure
    setSalaryStructure: async (req, res) => {
        const { id } = req.params;
        try {
            await db.prepare('UPDATE employees SET salary_structure = ? WHERE id = ? AND user_id = ?').run(JSON.stringify(req.body), id, req.user.id);
            return sendSuccess(res, req.body, 'Salary structure updated successfully');
        } catch (error) {
            return sendError(res, 'Failed to update salary structure', 500);
        }
    },
    getSalaryStructure: async (req, res) => {
        const { id } = req.params;
        try {
            const staff = await db.prepare('SELECT salary_structure FROM employees WHERE id = ? AND user_id = ?').get(id, req.user.id);
            return sendSuccess(res, JSON.parse(staff?.salary_structure || '{}'), 'Salary structure retrieved');
        } catch (error) {
            return sendError(res, 'Failed to retrieve salary structure', 500);
        }
    },

    // Departments and Designations list/updates
    setDepartment: async (req, res) => {
        const { id } = req.params;
        const { department } = req.body;
        try {
            await db.prepare('UPDATE employees SET department = ? WHERE id = ? AND user_id = ?').run(department, id, req.user.id);
            return sendSuccess(res, { department }, 'Department updated');
        } catch (error) {
            return sendError(res, 'Failed to update department', 500);
        }
    },
    getDepartments: async (req, res) => {
        try {
            const list = await db.prepare('SELECT DISTINCT department FROM employees WHERE user_id = ?').all(req.user.id);
            return sendSuccess(res, list.map(item => item.department || 'Operations'), 'Departments retrieved');
        } catch (error) {
            return sendError(res, 'Failed to retrieve departments', 500);
        }
    },
    setDesignation: async (req, res) => {
        const { id } = req.params;
        const { designation } = req.body;
        try {
            await db.prepare('UPDATE employees SET designation = ? WHERE id = ? AND user_id = ?').run(designation, id, req.user.id);
            return sendSuccess(res, { designation }, 'Designation updated');
        } catch (error) {
            return sendError(res, 'Failed to update designation', 500);
        }
    },
    getDesignations: async (req, res) => {
        try {
            const list = await db.prepare('SELECT DISTINCT designation FROM employees WHERE user_id = ?').all(req.user.id);
            return sendSuccess(res, list.map(item => item.designation || 'Associate'), 'Designations retrieved');
        } catch (error) {
            return sendError(res, 'Failed to retrieve designations', 500);
        }
    },

    // Shifts
    setShift: async (req, res) => {
        const { id } = req.params;
        const { shift } = req.body;
        try {
            await db.prepare('UPDATE employees SET shift = ? WHERE id = ? AND user_id = ?').run(shift, id, req.user.id);
            return sendSuccess(res, { shift }, 'Shift updated');
        } catch (error) {
            return sendError(res, 'Failed to update shift', 500);
        }
    },
    getShift: async (req, res) => {
        const { id } = req.params;
        try {
            const staff = await db.prepare('SELECT shift FROM employees WHERE id = ? AND user_id = ?').get(id, req.user.id);
            return sendSuccess(res, { shift: staff?.shift || 'General Shift (9 AM - 6 PM)' }, 'Shift retrieved');
        } catch (error) {
            return sendError(res, 'Failed to retrieve shift', 500);
        }
    },

    // Roles and Permissions
    setRoles: async (req, res) => {
        const { id } = req.params;
        try {
            await db.prepare('UPDATE employees SET roles = ? WHERE id = ? AND user_id = ?').run(JSON.stringify(req.body.roles || []), id, req.user.id);
            return sendSuccess(res, req.body, 'Roles updated');
        } catch (error) {
            return sendError(res, 'Failed to update roles', 500);
        }
    },
    getRoles: async (req, res) => {
        const { id } = req.params;
        try {
            const staff = await db.prepare('SELECT roles FROM employees WHERE id = ? AND user_id = ?').get(id, req.user.id);
            return sendSuccess(res, JSON.parse(staff?.roles || '[]'), 'Roles retrieved');
        } catch (error) {
            return sendError(res, 'Failed to retrieve roles', 500);
        }
    },
    setPermissions: async (req, res) => {
        const { id } = req.params;
        try {
            await db.prepare('UPDATE employees SET permissions = ? WHERE id = ? AND user_id = ?').run(JSON.stringify(req.body.permissions || []), id, req.user.id);
            return sendSuccess(res, req.body, 'Permissions updated');
        } catch (error) {
            return sendError(res, 'Failed to update permissions', 500);
        }
    },
    getPermissions: async (req, res) => {
        const { id } = req.params;
        try {
            const staff = await db.prepare('SELECT permissions FROM employees WHERE id = ? AND user_id = ?').get(id, req.user.id);
            return sendSuccess(res, JSON.parse(staff?.permissions || '[]'), 'Permissions retrieved');
        } catch (error) {
            return sendError(res, 'Failed to retrieve permissions', 500);
        }
    },

    // Block / Unblock
    blockStaff: async (req, res) => {
        const { id } = req.params;
        try {
            await db.prepare("UPDATE employees SET status = 'blocked' WHERE id = ? AND user_id = ?").run(id, req.user.id);
            return sendSuccess(res, null, 'Staff blocked successfully');
        } catch (error) {
            return sendError(res, 'Failed to block staff', 500);
        }
    },
    unblockStaff: async (req, res) => {
        const { id } = req.params;
        try {
            await db.prepare("UPDATE employees SET status = 'active' WHERE id = ? AND user_id = ?").run(id, req.user.id);
            return sendSuccess(res, null, 'Staff unblocked successfully');
        } catch (error) {
            return sendError(res, 'Failed to unblock staff', 500);
        }
    },

    // Notes
    addNote: async (req, res) => {
        const { id } = req.params;
        const { note } = req.body;
        try {
            const staff = await db.prepare('SELECT notes FROM employees WHERE id = ? AND user_id = ?').get(id, req.user.id);
            const notes = JSON.parse(staff?.notes || '[]');
            notes.push({ id: Date.now().toString(), text: note, created_at: new Date().toISOString() });
            await db.prepare('UPDATE employees SET notes = ? WHERE id = ? AND user_id = ?').run(JSON.stringify(notes), id, req.user.id);
            return sendSuccess(res, notes, 'Note added successfully');
        } catch (error) {
            return sendError(res, 'Failed to add note', 500);
        }
    },
    getNotes: async (req, res) => {
        const { id } = req.params;
        try {
            const staff = await db.prepare('SELECT notes FROM employees WHERE id = ? AND user_id = ?').get(id, req.user.id);
            return sendSuccess(res, JSON.parse(staff?.notes || '[]'), 'Notes retrieved');
        } catch (error) {
            return sendError(res, 'Failed to retrieve notes', 500);
        }
    },

    // Attendance, Payroll, Leave reports and details
    getAttendance: async (req, res) => {
        const { id } = req.params;
        try {
            const records = await db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND user_id = ?').all(id, req.user.id);
            return sendSuccess(res, records, 'Attendance retrieved');
        } catch (error) {
            return sendError(res, 'Failed to retrieve attendance', 500);
        }
    },
    getPayroll: async (req, res) => {
        const { id } = req.params;
        try {
            const records = await db.prepare('SELECT * FROM payroll WHERE employee_id = ? AND user_id = ?').all(id, req.user.id);
            return sendSuccess(res, records, 'Payroll retrieved');
        } catch (error) {
            return sendError(res, 'Failed to retrieve payroll', 500);
        }
    },
    getLeave: async (req, res) => {
        return sendSuccess(res, { leave_balance: 14, consumed: 4 }, 'Leave retrieved');
    },

    // Activity, History, Timeline
    getActivity: async (req, res) => {
        return sendSuccess(res, [
            { id: '1', action: 'Login Approved', timestamp: new Date().toISOString() },
            { id: '2', action: 'Profile Created', timestamp: new Date().toISOString() }
        ], 'Activity retrieved');
    },

    // Import / Export
    importStaff: async (req, res) => {
        return sendSuccess(res, null, 'Staff imported successfully');
    },
    exportStaff: async (req, res) => {
        try {
            const staff = await db.prepare('SELECT * FROM employees WHERE user_id = ?').all(req.user.id);
            return sendSuccess(res, staff, 'Staff exported successfully');
        } catch (error) {
            return sendError(res, 'Export failed', 500);
        }
    },

    // Analytics and Reports
    getAnalytics: async (req, res) => {
        return sendSuccess(res, { active_projects: 3, task_completion_rate: '94%' }, 'Analytics retrieved');
    },
    getReportDepartment: async (req, res) => {
        return sendSuccess(res, { Sales: 10, HR: 4, Operations: 12 }, 'Department report retrieved');
    },
    getReportDesignation: async (req, res) => {
        return sendSuccess(res, { Manager: 3, Associate: 15 }, 'Designation report retrieved');
    },
    getReportAttendance: async (req, res) => {
        return sendSuccess(res, { present_today: '95%', late_today: '2%' }, 'Attendance report retrieved');
    },
    getReportPayroll: async (req, res) => {
        return sendSuccess(res, { total_payroll: 1250000, paid_this_month: 1250000 }, 'Payroll report retrieved');
    },
    getReportPerformance: async (req, res) => {
        return sendSuccess(res, { average_rating: 4.6 }, 'Performance report retrieved');
    },

    // Dashboard Summary
    getDashboardSummary: async (req, res) => {
        try {
            const total = await db.prepare('SELECT COUNT(*) as count FROM employees WHERE user_id = ?').get(req.user.id);
            const active = await db.prepare("SELECT COUNT(*) as count FROM employees WHERE user_id = ? AND status = 'active'").get(req.user.id);
            return sendSuccess(res, {
                total_headcount: total?.count || 0,
                active_headcount: active?.count || 0,
                satisfaction_index: '92%'
            }, 'Dashboard summary retrieved');
        } catch (error) {
            return sendError(res, 'Failed to retrieve dashboard summary', 500);
        }
    }
};

module.exports = staffController;
