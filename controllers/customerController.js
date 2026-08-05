const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { logAuditEvent } = require('../utils/auditLogger');

const customerController = {
    getCustomers: async (req, res) => {
        try {
            const userId = req.user.id;
            const { q, status, state, page = 1, limit = 50 } = req.query;
            const offset = (parseInt(page) - 1) * parseInt(limit);

            let sql = "SELECT * FROM business_customers WHERE user_id = ?";
            const params = [userId];

            if (q) {
                sql += " AND (name LIKE ? OR company LIKE ? OR email LIKE ? OR phone LIKE ? OR gstin LIKE ?)";
                const searchTerm = `%${q}%`;
                params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
            }

            if (status) {
                sql += " AND status = ?";
                params.push(status);
            }

            if (state) {
                sql += " AND state = ?";
                params.push(state);
            }

            // Total count query
            const countSql = sql.replace("SELECT *", "SELECT COUNT(*) as total");
            const totalRes = await db.prepare(countSql).get(...params);
            const total = totalRes ? totalRes.total : 0;

            sql += " ORDER BY id DESC LIMIT ? OFFSET ?";
            params.push(parseInt(limit), offset);

            const customers = await db.prepare(sql).all(...params);

            return sendSuccess(res, {
                customers,
                pagination: {
                    total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages: Math.ceil(total / parseInt(limit))
                }
            }, 'Customers fetched successfully');
        } catch (error) {
            console.error('[Customer Controller Error]', error);
            return sendError(res, 'Failed to fetch customers', 500);
        }
    },

    getCustomerById: async (req, res) => {
        try {
            const { id } = req.params;
            const customer = await db.prepare('SELECT * FROM business_customers WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!customer) {
                return sendError(res, 'Customer not found', 404);
            }
            return sendSuccess(res, customer, 'Customer fetched successfully');
        } catch (error) {
            return sendError(res, 'Failed to fetch customer details', 500);
        }
    },

    createCustomer: async (req, res) => {
        try {
            const userId = req.user.id;
            const { name, company, gstin, pan, email, phone, address, state, country = 'India', openingBalance = 0, creditLimit = 0, status = 'Active' } = req.body;

            if (!name) {
                return sendError(res, 'Customer name is required', 400);
            }

            const now = new Date().toISOString();
            const result = await db.prepare(`
                INSERT INTO business_customers (
                    user_id, name, company, gstin, pan, email, phone, address, state, country, 
                    opening_balance, credit_limit, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                userId, name, company || null, gstin || null, pan || null, email || null, phone || null,
                address || null, state || null, country, parseFloat(openingBalance) || 0,
                parseFloat(creditLimit) || 0, status, now, now
            );

            const newCustomer = await db.prepare('SELECT * FROM business_customers WHERE id = ?').get(result.lastInsertRowid);

            await logAuditEvent(req, {
                action: 'Create Customer',
                module: 'Customers',
                recordId: newCustomer.id,
                newValue: newCustomer,
                details: `Created customer "${name}"`
            });

            return sendSuccess(res, newCustomer, 'Customer created successfully', 201);
        } catch (error) {
            console.error('[Create Customer Error]', error);
            return sendError(res, 'Failed to create customer', 500);
        }
    },

    updateCustomer: async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.user.id;
            const existing = await db.prepare('SELECT * FROM business_customers WHERE id = ? AND user_id = ?').get(id, userId);

            if (!existing) {
                return sendError(res, 'Customer not found', 404);
            }

            const { name, company, gstin, pan, email, phone, address, state, country, openingBalance, creditLimit, status } = req.body;
            const now = new Date().toISOString();

            await db.prepare(`
                UPDATE business_customers SET
                    name = COALESCE(?, name),
                    company = COALESCE(?, company),
                    gstin = COALESCE(?, gstin),
                    pan = COALESCE(?, pan),
                    email = COALESCE(?, email),
                    phone = COALESCE(?, phone),
                    address = COALESCE(?, address),
                    state = COALESCE(?, state),
                    country = COALESCE(?, country),
                    opening_balance = COALESCE(?, opening_balance),
                    credit_limit = COALESCE(?, credit_limit),
                    status = COALESCE(?, status),
                    updated_at = ?
                WHERE id = ? AND user_id = ?
            `).run(
                name, company, gstin, pan, email, phone, address, state, country,
                openingBalance !== undefined ? parseFloat(openingBalance) : null,
                creditLimit !== undefined ? parseFloat(creditLimit) : null,
                status, now, id, userId
            );

            const updated = await db.prepare('SELECT * FROM business_customers WHERE id = ?').get(id);

            await logAuditEvent(req, {
                action: 'Update Customer',
                module: 'Customers',
                recordId: id,
                oldValue: existing,
                newValue: updated,
                details: `Updated customer "${updated.name}"`
            });

            return sendSuccess(res, updated, 'Customer updated successfully');
        } catch (error) {
            console.error('[Update Customer Error]', error);
            return sendError(res, 'Failed to update customer', 500);
        }
    },

    deleteCustomer: async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.user.id;
            const existing = await db.prepare('SELECT * FROM business_customers WHERE id = ? AND user_id = ?').get(id, userId);

            if (!existing) {
                return sendError(res, 'Customer not found', 404);
            }

            await db.prepare('DELETE FROM business_customers WHERE id = ? AND user_id = ?').run(id, userId);

            await logAuditEvent(req, {
                action: 'Delete Customer',
                module: 'Customers',
                recordId: id,
                oldValue: existing,
                details: `Deleted customer "${existing.name}"`
            });

            return sendSuccess(res, { id }, 'Customer deleted successfully');
        } catch (error) {
            return sendError(res, 'Failed to delete customer', 500);
        }
    }
};

module.exports = customerController;
