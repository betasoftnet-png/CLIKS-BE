const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

const auditLogController = {
    getAuditLogs: async (req, res) => {
        try {
            const { module: modFilter, action: actionFilter, q, page = 1, limit = 50 } = req.query;
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
    }
};

module.exports = auditLogController;
