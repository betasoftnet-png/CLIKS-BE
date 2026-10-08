const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

const auditLogController = {
    getAuditLogs: async (req, res) => {
        try {
            const { module: modFilter, action: actionFilter, q, customer_id, page = 1, limit = 50 } = req.query;
            const offset = (parseInt(page) - 1) * parseInt(limit);

            let sql = "SELECT * FROM audit_logs WHERE 1=1";
            const params = [];

            if (req.user.role !== 'admin' && req.user.role !== 'ca') {
                sql += " AND (user_id = ? OR user_id IS NULL)";
                params.push(req.user.id);
            }

            if (modFilter) {
                sql += " AND module = ?";
                params.push(modFilter);
            }

            if (actionFilter) {
                sql += " AND (action = ? OR action_type = ?)";
                params.push(actionFilter, actionFilter);
            }

            if (customer_id) {
                sql += " AND customer_id = ?";
                params.push(customer_id);
            }

            if (q) {
                sql += " AND (message LIKE ? OR actor LIKE ? OR module LIKE ? OR action LIKE ?)";
                const searchTerm = `%${q}%`;
                params.push(searchTerm, searchTerm, searchTerm, searchTerm);
            }

            const countSql = sql.replace("SELECT *", "SELECT COUNT(*) as total");
            const totalRes = await db.prepare(countSql).get(...params);
            const total = totalRes ? totalRes.total : 0;

            sql += " ORDER BY id DESC LIMIT ? OFFSET ?";
            params.push(parseInt(limit), offset);

            const logs = await db.prepare(sql).all(...params);

            return sendSuccess(res, {
                logs,
                pagination: {
                    total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages: Math.ceil(total / parseInt(limit))
                }
            }, 'Audit logs fetched successfully');
        } catch (error) {
            console.error('[Audit Log Controller Error]', error);
            return sendError(res, 'Failed to fetch audit logs', 500);
        }
    },
    
    logActivity: async (req, res) => {
        try {
            const { action_type, message, module: mod, action, customer_id, old_value, new_value } = req.body;
            
            const sql = `INSERT INTO audit_logs 
                       (user_id, role, action_type, message, actor, severity, module, action, customer_id, old_value, new_value, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`;
            
            const params = [
                req.user.id,
                req.user.role || 'ca',
                action_type || 'SYSTEM_ACTION',
                message,
                req.user.name || req.user.email || 'System User',
                'INFO',
                mod || 'CA',
                action || action_type,
                customer_id || null,
                old_value ? JSON.stringify(old_value) : null,
                new_value ? JSON.stringify(new_value) : null
            ];

            const result = await db.prepare(sql).run(...params);
            
            return sendSuccess(res, { id: result.lastInsertRowid }, 'Activity logged successfully under Rule 11(g)');
        } catch (error) {
            console.error('[Audit Log Activity Error]', error);
            return sendError(res, 'Failed to log activity', 500);
        }
    }
};

module.exports = auditLogController;
