const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { logAuditEvent } = require('../utils/auditLogger');
const storageController = require('./storageController');

const documentController = {
    getDocuments: async (req, res) => {
        try {
            const userId = req.user.id;
            const { category, status, taskId, q, page = 1, limit = 50 } = req.query;
            const offset = (parseInt(page) - 1) * parseInt(limit);

            let sql = "SELECT * FROM documents WHERE (business_owner_id = ? OR ca_id = ? OR uploaded_by = ?)";
            const params = [userId, userId, userId];

            if (category) {
                sql += " AND category = ?";
                params.push(category);
            }

            if (status) {
                sql += " AND status = ?";
                params.push(status);
            }

            if (taskId) {
                sql += " AND task_id = ?";
                params.push(taskId);
            }

            if (q) {
                sql += " AND (name LIKE ? OR category LIKE ? OR remarks LIKE ?)";
                const searchTerm = `%${q}%`;
                params.push(searchTerm, searchTerm, searchTerm);
            }

            const countSql = sql.replace("SELECT *", "SELECT COUNT(*) as total");
            const totalRes = await db.prepare(countSql).get(...params);
            const total = totalRes ? totalRes.total : 0;

            sql += " ORDER BY id DESC LIMIT ? OFFSET ?";
            params.push(parseInt(limit), offset);

            const docs = await db.prepare(sql).all(...params);

            return sendSuccess(res, {
                documents: docs,
                pagination: {
                    total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages: Math.ceil(total / parseInt(limit))
                }
            }, 'Documents fetched successfully');
        } catch (error) {
            console.error('[Document Controller Error]', error);
            return sendError(res, 'Failed to fetch documents', 500);
        }
    },

    getDocumentById: async (req, res) => {
        try {
            const { id } = req.params;
            const doc = await db.prepare('SELECT * FROM documents WHERE id = ? AND (business_owner_id = ? OR ca_id = ? OR uploaded_by = ?)').get(id, req.user.id, req.user.id, req.user.id);
            if (!doc) {
                return sendError(res, 'Document not found', 404);
            }
            return sendSuccess(res, doc, 'Document fetched successfully');
        } catch (error) {
            return sendError(res, 'Failed to fetch document details', 500);
        }
    },

    createDocument: async (req, res) => {
        try {
            const userId = req.user.id;
            const { name, category = 'General', filePath, caId, taskId, remarks, version = 1 } = req.body;

            if (!name || !filePath) {
                return sendError(res, 'Document name and file path are required', 400);
            }

            const now = new Date().toISOString();
            const result = await db.prepare(`
                INSERT INTO documents (
                    business_owner_id, ca_id, task_id, name, category, version, file_path,
                    uploaded_by, uploaded_date, status, remarks, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Uploaded', ?, ?, ?)
            `).run(
                req.user.role === 'business' ? userId : (caId || userId),
                caId || null,
                taskId || null,
                name,
                category,
                parseInt(version) || 1,
                filePath,
                userId,
                now,
                remarks || null,
                now,
                now
            );

            const newDoc = await db.prepare('SELECT * FROM documents WHERE id = ?').get(result.lastInsertRowid);

            await storageController.recordStorageFileHelper(userId, name, 'application/pdf', 350000, filePath, category);

            await logAuditEvent(req, {
                action: 'Document Upload',
                module: 'Document Management',
                recordId: newDoc.id,
                newValue: newDoc,
                details: `Uploaded document "${name}" (V${newDoc.version})`
            });

            return sendSuccess(res, newDoc, 'Document uploaded successfully', 201);
        } catch (error) {
            console.error('[Create Document Error]', error);
            return sendError(res, 'Failed to upload document', 500);
        }
    },

    updateDocument: async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.user.id;
            const existing = await db.prepare('SELECT * FROM documents WHERE id = ? AND (business_owner_id = ? OR ca_id = ? OR uploaded_by = ?)').get(id, userId, userId, userId);

            if (!existing) {
                return sendError(res, 'Document not found', 404);
            }

            const { name, category, status, remarks, version } = req.body;
            const now = new Date().toISOString();

            await db.prepare(`
                UPDATE documents SET
                    name = COALESCE(?, name),
                    category = COALESCE(?, category),
                    status = COALESCE(?, status),
                    remarks = COALESCE(?, remarks),
                    version = COALESCE(?, version),
                    updated_at = ?
                WHERE id = ?
            `).run(name, category, status, remarks, version !== undefined ? parseInt(version) : null, now, id);

            const updated = await db.prepare('SELECT * FROM documents WHERE id = ?').get(id);

            await logAuditEvent(req, {
                action: 'Update Document',
                module: 'Document Management',
                recordId: id,
                oldValue: existing,
                newValue: updated,
                details: `Updated document "${updated.name}" status to "${updated.status}"`
            });

            return sendSuccess(res, updated, 'Document updated successfully');
        } catch (error) {
            console.error('[Update Document Error]', error);
            return sendError(res, 'Failed to update document', 500);
        }
    },

    deleteDocument: async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.user.id;
            const existing = await db.prepare('SELECT * FROM documents WHERE id = ? AND (business_owner_id = ? OR ca_id = ? OR uploaded_by = ?)').get(id, userId, userId, userId);

            if (!existing) {
                return sendError(res, 'Document not found', 404);
            }

            await db.prepare('DELETE FROM documents WHERE id = ?').run(id);

            await logAuditEvent(req, {
                action: 'Delete Document',
                module: 'Document Management',
                recordId: id,
                oldValue: existing,
                details: `Deleted document "${existing.name}"`
            });

            return sendSuccess(res, { id }, 'Document deleted successfully');
        } catch (error) {
            return sendError(res, 'Failed to delete document', 500);
        }
    }
};

module.exports = documentController;
