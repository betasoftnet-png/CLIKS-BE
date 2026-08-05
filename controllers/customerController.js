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
            console.log("=== CREATE CUSTOMER REQUEST ===");
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

            await logAuditEvent(req, {
                action: 'Create Customer',
                module: 'Customers',
                recordId: newCustomer.id,
                newValue: newCustomer,
                details: `Created customer "${name}"`
            });

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
