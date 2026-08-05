const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { logAuditEvent } = require('../utils/auditLogger');

const vendorController = {
    getVendors: async (req, res) => {
        try {
            const userId = req.user.id;
            const { q, status, page = 1, limit = 50 } = req.query;
            const offset = (parseInt(page) - 1) * parseInt(limit);

            let sql = "SELECT * FROM vendors WHERE user_id = ?";
            const params = [userId];

            if (q) {
                sql += " AND (name LIKE ? OR email LIKE ? OR phone LIKE ? OR gstin LIKE ? OR pan LIKE ?)";
                const searchTerm = `%${q}%`;
                params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
            }

            if (status) {
                sql += " AND status = ?";
                params.push(status);
            }

            const countSql = sql.replace("SELECT *", "SELECT COUNT(*) as total");
            const totalRes = await db.prepare(countSql).get(...params);
            const total = totalRes ? totalRes.total : 0;

            sql += " ORDER BY id DESC LIMIT ? OFFSET ?";
            params.push(parseInt(limit), offset);

            const vendors = await db.prepare(sql).all(...params);

            return sendSuccess(res, {
                vendors,
                pagination: {
                    total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages: Math.ceil(total / parseInt(limit))
                }
            }, 'Vendors fetched successfully');
        } catch (error) {
            console.error('[Vendor Controller Error]', error);
            return sendError(res, 'Failed to fetch vendors', 500);
        }
    },

    getVendorById: async (req, res) => {
        try {
            const { id } = req.params;
            const vendor = await db.prepare('SELECT * FROM vendors WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!vendor) {
                return sendError(res, 'Vendor not found', 404);
            }
            return sendSuccess(res, vendor, 'Vendor fetched successfully');
        } catch (error) {
            return sendError(res, 'Failed to fetch vendor details', 500);
        }
    },

    createVendor: async (req, res) => {
        try {
            const userId = req.user.id;
            const { name, gstin, pan, email, phone, address, bankDetails, openingBalance = 0, status = 'Active' } = req.body;

            if (!name) {
                return sendError(res, 'Vendor name is required', 400);
            }

            const now = new Date().toISOString();
            const bankDetailsStr = typeof bankDetails === 'object' ? JSON.stringify(bankDetails) : (bankDetails || null);

            const result = await db.prepare(`
                INSERT INTO vendors (
                    user_id, name, gstin, pan, email, phone, address, bank_details, opening_balance, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                userId, name, gstin || null, pan || null, email || null, phone || null, address || null,
                bankDetailsStr, parseFloat(openingBalance) || 0, status, now, now
            );

            const newVendor = await db.prepare('SELECT * FROM vendors WHERE id = ?').get(result.lastInsertRowid);

            await logAuditEvent(req, {
                action: 'Create Vendor',
                module: 'Vendors',
                recordId: newVendor.id,
                newValue: newVendor,
                details: `Created vendor "${name}"`
            });

            return sendSuccess(res, newVendor, 'Vendor created successfully', 201);
        } catch (error) {
            console.error('[Create Vendor Error]', error);
            return sendError(res, 'Failed to create vendor', 500);
        }
    },

    updateVendor: async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.user.id;
            const existing = await db.prepare('SELECT * FROM vendors WHERE id = ? AND user_id = ?').get(id, userId);

            if (!existing) {
                return sendError(res, 'Vendor not found', 404);
            }

            const { name, gstin, pan, email, phone, address, bankDetails, openingBalance, status } = req.body;
            const now = new Date().toISOString();
            const bankDetailsStr = bankDetails !== undefined ? (typeof bankDetails === 'object' ? JSON.stringify(bankDetails) : bankDetails) : null;

            await db.prepare(`
                UPDATE vendors SET
                    name = COALESCE(?, name),
                    gstin = COALESCE(?, gstin),
                    pan = COALESCE(?, pan),
                    email = COALESCE(?, email),
                    phone = COALESCE(?, phone),
                    address = COALESCE(?, address),
                    bank_details = COALESCE(?, bank_details),
                    opening_balance = COALESCE(?, opening_balance),
                    status = COALESCE(?, status),
                    updated_at = ?
                WHERE id = ? AND user_id = ?
            `).run(
                name, gstin, pan, email, phone, address, bankDetailsStr,
                openingBalance !== undefined ? parseFloat(openingBalance) : null,
                status, now, id, userId
            );

            const updated = await db.prepare('SELECT * FROM vendors WHERE id = ?').get(id);

            await logAuditEvent(req, {
                action: 'Update Vendor',
                module: 'Vendors',
                recordId: id,
                oldValue: existing,
                newValue: updated,
                details: `Updated vendor "${updated.name}"`
            });

            return sendSuccess(res, updated, 'Vendor updated successfully');
        } catch (error) {
            console.error('[Update Vendor Error]', error);
            return sendError(res, 'Failed to update vendor', 500);
        }
    },

    deleteVendor: async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.user.id;
            const existing = await db.prepare('SELECT * FROM vendors WHERE id = ? AND user_id = ?').get(id, userId);

            if (!existing) {
                return sendError(res, 'Vendor not found', 404);
            }

            await db.prepare('DELETE FROM vendors WHERE id = ? AND user_id = ?').run(id, userId);

            await logAuditEvent(req, {
                action: 'Delete Vendor',
                module: 'Vendors',
                recordId: id,
                oldValue: existing,
                details: `Deleted vendor "${existing.name}"`
            });

            return sendSuccess(res, { id }, 'Vendor deleted successfully');
        } catch (error) {
            return sendError(res, 'Failed to delete vendor', 500);
        }
    }
};

module.exports = vendorController;
