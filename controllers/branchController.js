const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

// Self-healing runtime table initialization
const initTables = async () => {
    try {
        const dbType = process.env.DB_TYPE || 'sqlite';
        const idType = dbType === 'postgres' ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';

        await db.prepare(`
            CREATE TABLE IF NOT EXISTS branches (
                id ${idType},
                user_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                code TEXT NOT NULL,
                invoice_prefix TEXT DEFAULT 'INV',
                address TEXT,
                city TEXT,
                state TEXT,
                pincode TEXT,
                phone TEXT,
                email TEXT,
                gstin TEXT,
                is_main_branch BOOLEAN DEFAULT 0,
                status TEXT DEFAULT 'active',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `).run();

        // Index on user_id and code
        try {
            await db.prepare(`CREATE INDEX IF NOT EXISTS idx_branches_user ON branches(user_id)`).run();
        } catch (e) {}

        await db.prepare(`
            CREATE TABLE IF NOT EXISTS branch_stock (
                id ${idType},
                user_id INTEGER NOT NULL,
                branch_id INTEGER NOT NULL,
                product_id INTEGER NOT NULL,
                quantity REAL DEFAULT 0,
                low_stock_threshold REAL DEFAULT 5,
                rack_location TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `).run();

        try {
            await db.prepare(`CREATE INDEX IF NOT EXISTS idx_branch_stock_lookup ON branch_stock(branch_id, product_id)`).run();
            await db.prepare(`CREATE INDEX IF NOT EXISTS idx_branch_stock_user ON branch_stock(user_id)`).run();
        } catch (e) {}

        await db.prepare(`
            CREATE TABLE IF NOT EXISTS branch_transfers (
                id ${idType},
                user_id INTEGER NOT NULL,
                transfer_no TEXT,
                from_branch_id INTEGER NOT NULL,
                to_branch_id INTEGER NOT NULL,
                status TEXT DEFAULT 'completed',
                items TEXT NOT NULL,
                notes TEXT,
                dispatched_at TEXT,
                received_at TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `).run();

        try {
            await db.prepare(`CREATE INDEX IF NOT EXISTS idx_transfers_user ON branch_transfers(user_id)`).run();
        } catch (e) {}

        // Add branch columns to business_invoices if not exist
        try {
            await db.prepare(`ALTER TABLE business_invoices ADD COLUMN branch_id INTEGER`).run();
        } catch (e) {}
        try {
            await db.prepare(`ALTER TABLE business_invoices ADD COLUMN branch_name TEXT`).run();
        } catch (e) {}

    } catch (err) {
        console.warn('[Branch Controller] Table init warning:', err.message);
    }
};

initTables();

// Helper: auto-provision default "Main Showroom" if business has zero branches
const ensureDefaultBranch = async (userId) => {
    try {
        const countRow = await db.prepare('SELECT COUNT(*) as count FROM branches WHERE user_id = ?').get(userId);
        if (!countRow || countRow.count === 0) {
            const now = new Date().toISOString();
            const res = await db.prepare(`
                INSERT INTO branches (
                    user_id, name, code, invoice_prefix, address, city, state, pincode, 
                    phone, email, is_main_branch, status, created_at, updated_at
                ) VALUES (?, 'Main Showroom', 'MAIN-01', 'MS-', 'Central Commercial Hub', 'Chennai', 'Tamil Nadu', '600001', '', '', 1, 'active', ?, ?)
            `).run(userId, now, now);

            const newBranchId = res.lastInsertRowid || res.id;

            // Sync all existing products into this default branch with their current quantity
            try {
                const prods = await db.prepare('SELECT id, quantity, low_stock_threshold FROM business_products WHERE user_id = ?').all(userId);
                for (const p of prods) {
                    await db.prepare(`
                        INSERT INTO branch_stock (user_id, branch_id, product_id, quantity, low_stock_threshold, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    `).run(userId, newBranchId, p.id, p.quantity || 0, p.low_stock_threshold || 5, now, now);
                }
            } catch (pErr) {}

            return newBranchId;
        }
    } catch (e) {
        console.warn('[Branch Controller] Error provisioning default branch:', e.message);
    }
    return null;
};

const branchController = {
    // 1. GET /api/v1/branches - List all branches for business
    getBranches: async (req, res) => {
        try {
            const userId = req.user.id;
            await ensureDefaultBranch(userId);

            const branches = await db.prepare(`
                SELECT b.*,
                    (SELECT COUNT(DISTINCT product_id) FROM branch_stock WHERE branch_id = b.id AND quantity > 0) as active_products_count,
                    (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE branch_id = b.id) as total_stock_quantity
                FROM branches b
                WHERE b.user_id = ? AND b.status != 'deleted'
                ORDER BY b.is_main_branch DESC, b.created_at ASC
            `).all(userId);

            // Add assigned flag if requester is a Sub-ID
            const enriched = branches.map(b => ({
                ...b,
                is_assigned: req.user.branch_id ? req.user.branch_id === b.id : true
            }));

            return sendSuccess(res, enriched, 'Branches retrieved successfully');
        } catch (error) {
            console.error('[Branch Controller] Error fetching branches:', error);
            return sendError(res, 'Failed to fetch branches', 500);
        }
    },

    // 2. GET /api/v1/branches/:id - Get single branch details & stats
    getBranchById: async (req, res) => {
        try {
            const userId = req.user.id;
            const branchId = parseInt(req.params.id);

            const branch = await db.prepare(`
                SELECT b.*,
                    (SELECT COUNT(DISTINCT product_id) FROM branch_stock WHERE branch_id = b.id AND quantity > 0) as active_products_count,
                    (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE branch_id = b.id) as total_stock_quantity
                FROM branches b
                WHERE b.id = ? AND b.user_id = ?
            `).get(branchId, userId);

            if (!branch) {
                return sendError(res, 'Branch not found', 404);
            }

            // Calculate today's sales for this branch
            const today = new Date().toISOString().split('T')[0];
            let todaySales = 0;
            try {
                const salesRow = await db.prepare(`
                    SELECT COALESCE(SUM(total_amount), 0) as total 
                    FROM business_invoices 
                    WHERE user_id = ? AND branch_id = ? AND created_at LIKE ?
                `).get(userId, branchId, `${today}%`);
                if (salesRow) todaySales = salesRow.total;
            } catch (e) {}

            return sendSuccess(res, { ...branch, today_sales: todaySales }, 'Branch details retrieved');
        } catch (error) {
            console.error('[Branch Controller] Error fetching branch:', error);
            return sendError(res, 'Failed to fetch branch details', 500);
        }
    },

    // 3. POST /api/v1/branches - Create new showroom/branch
    createBranch: async (req, res) => {
        try {
            const userId = req.user.id;
            const {
                name, code, invoice_prefix, address, city, state, pincode,
                phone, email, gstin, is_main_branch
            } = req.body;

            if (!name || !name.trim()) {
                return sendError(res, 'Branch Name is required', 400);
            }

            const cleanCode = (code || `BR-${Date.now().toString().slice(-4)}`).toUpperCase().trim();
            const cleanPrefix = (invoice_prefix || cleanCode.slice(0, 3) + '-').toUpperCase().trim();

            // Check duplicate code for this business
            const existing = await db.prepare('SELECT id FROM branches WHERE user_id = ? AND UPPER(code) = ? AND status != "deleted"').get(userId, cleanCode);
            if (existing) {
                return sendError(res, `Branch code "${cleanCode}" already exists. Please choose a unique code.`, 400);
            }

            const now = new Date().toISOString();

            // If marked as main branch, reset other main branches
            if (is_main_branch) {
                await db.prepare('UPDATE branches SET is_main_branch = 0 WHERE user_id = ?').run(userId);
            }

            const result = await db.prepare(`
                INSERT INTO branches (
                    user_id, name, code, invoice_prefix, address, city, state, pincode,
                    phone, email, gstin, is_main_branch, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
            `).run(
                userId,
                name.trim(),
                cleanCode,
                cleanPrefix,
                address || '',
                city || '',
                state || '',
                pincode || '',
                phone || '',
                email || '',
                gstin || '',
                is_main_branch ? 1 : 0,
                now,
                now
            );

            const newBranchId = result.lastInsertRowid || result.id;

            // Automatically populate branch_stock for all existing products of this business
            try {
                const prods = await db.prepare('SELECT id, low_stock_threshold FROM business_products WHERE user_id = ?').all(userId);
                for (const p of prods) {
                    await db.prepare(`
                        INSERT INTO branch_stock (user_id, branch_id, product_id, quantity, low_stock_threshold, created_at, updated_at)
                        VALUES (?, ?, ?, 0, ?, ?, ?)
                    `).run(userId, newBranchId, p.id, p.low_stock_threshold || 5, now, now);
                }
            } catch (syncErr) {
                console.warn('[Branch Controller] Stock sync warning on create:', syncErr.message);
            }

            const createdBranch = await db.prepare('SELECT * FROM branches WHERE id = ?').get(newBranchId);
            return sendSuccess(res, createdBranch, 'Branch created successfully', 201);
        } catch (error) {
            console.error('[Branch Controller] Error creating branch:', error);
            return sendError(res, 'Failed to create branch: ' + error.message, 500);
        }
    },

    // 4. PUT /api/v1/branches/:id - Update showroom details
    updateBranch: async (req, res) => {
        try {
            const userId = req.user.id;
            const branchId = parseInt(req.params.id);

            const existing = await db.prepare('SELECT id FROM branches WHERE id = ? AND user_id = ?').get(branchId, userId);
            if (!existing) {
                return sendError(res, 'Branch not found', 404);
            }

            const {
                name, code, invoice_prefix, address, city, state, pincode,
                phone, email, gstin, is_main_branch, status
            } = req.body;

            const now = new Date().toISOString();

            if (is_main_branch) {
                await db.prepare('UPDATE branches SET is_main_branch = 0 WHERE user_id = ?').run(userId);
            }

            await db.prepare(`
                UPDATE branches SET
                    name = COALESCE(?, name),
                    code = COALESCE(?, code),
                    invoice_prefix = COALESCE(?, invoice_prefix),
                    address = COALESCE(?, address),
                    city = COALESCE(?, city),
                    state = COALESCE(?, state),
                    pincode = COALESCE(?, pincode),
                    phone = COALESCE(?, phone),
                    email = COALESCE(?, email),
                    gstin = COALESCE(?, gstin),
                    is_main_branch = COALESCE(?, is_main_branch),
                    status = COALESCE(?, status),
                    updated_at = ?
                WHERE id = ? AND user_id = ?
            `).run(
                name?.trim() || null,
                code?.toUpperCase().trim() || null,
                invoice_prefix?.toUpperCase().trim() || null,
                address !== undefined ? address : null,
                city !== undefined ? city : null,
                state !== undefined ? state : null,
                pincode !== undefined ? pincode : null,
                phone !== undefined ? phone : null,
                email !== undefined ? email : null,
                gstin !== undefined ? gstin : null,
                is_main_branch !== undefined ? (is_main_branch ? 1 : 0) : null,
                status || null,
                now,
                branchId,
                userId
            );

            const updated = await db.prepare('SELECT * FROM branches WHERE id = ?').get(branchId);
            return sendSuccess(res, updated, 'Branch updated successfully');
        } catch (error) {
            console.error('[Branch Controller] Error updating branch:', error);
            return sendError(res, 'Failed to update branch', 500);
        }
    },

    // 5. DELETE /api/v1/branches/:id - Soft delete branch
    deleteBranch: async (req, res) => {
        try {
            const userId = req.user.id;
            const branchId = parseInt(req.params.id);

            const branch = await db.prepare('SELECT id, is_main_branch FROM branches WHERE id = ? AND user_id = ?').get(branchId, userId);
            if (!branch) return sendError(res, 'Branch not found', 404);
            if (branch.is_main_branch) return sendError(res, 'Cannot delete the Primary/Main Showroom', 400);

            // Check remaining branches
            const totalCount = await db.prepare('SELECT COUNT(*) as count FROM branches WHERE user_id = ? AND status != "deleted"').get(userId);
            if (totalCount?.count <= 1) {
                return sendError(res, 'Cannot delete your only remaining branch', 400);
            }

            await db.prepare('UPDATE branches SET status = "deleted", updated_at = ? WHERE id = ? AND user_id = ?')
                .run(new Date().toISOString(), branchId, userId);

            return sendSuccess(res, null, 'Branch deactivated successfully');
        } catch (error) {
            console.error('[Branch Controller] Error deleting branch:', error);
            return sendError(res, 'Failed to delete branch', 500);
        }
    },

    // 6. GET /api/v1/branches/:id/stock - Products with stock for this branch
    getBranchStock: async (req, res) => {
        try {
            const userId = req.user.id;
            const branchId = parseInt(req.params.id);

            const rows = await db.prepare(`
                SELECT 
                    p.id,
                    p.name,
                    p.sku,
                    p.category,
                    p.unit,
                    p.barcode,
                    p.selling_price,
                    p.purchase_price,
                    p.tax_percentage,
                    p.hsn_code,
                    COALESCE(bs.quantity, 0) as branch_quantity,
                    COALESCE(bs.low_stock_threshold, p.low_stock_threshold, 5) as low_stock_threshold,
                    bs.rack_location
                FROM business_products p
                LEFT JOIN branch_stock bs ON bs.product_id = p.id AND bs.branch_id = ?
                WHERE p.user_id = ? AND p.status != 'deleted'
                ORDER BY p.name ASC
            `).all(branchId, userId);

            return sendSuccess(res, rows, 'Branch stock fetched successfully');
        } catch (error) {
            console.error('[Branch Controller] Error fetching branch stock:', error);
            return sendError(res, 'Failed to fetch branch stock', 500);
        }
    },

    // 7. POST /api/v1/branches/stock/adjust - Adjust stock at a branch
    adjustBranchStock: async (req, res) => {
        try {
            const userId = req.user.id;
            const { branch_id, product_id, quantity, low_stock_threshold, rack_location } = req.body;

            if (!branch_id || !product_id) {
                return sendError(res, 'branch_id and product_id are required', 400);
            }

            const now = new Date().toISOString();
            const newQty = parseFloat(quantity) || 0;

            const existing = await db.prepare('SELECT id FROM branch_stock WHERE branch_id = ? AND product_id = ? AND user_id = ?')
                .get(branch_id, product_id, userId);

            if (existing) {
                await db.prepare(`
                    UPDATE branch_stock 
                    SET quantity = ?, 
                        low_stock_threshold = COALESCE(?, low_stock_threshold),
                        rack_location = COALESCE(?, rack_location),
                        updated_at = ?
                    WHERE id = ?
                `).run(newQty, low_stock_threshold !== undefined ? low_stock_threshold : null, rack_location || null, now, existing.id);
            } else {
                await db.prepare(`
                    INSERT INTO branch_stock (user_id, branch_id, product_id, quantity, low_stock_threshold, rack_location, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `).run(userId, branch_id, product_id, newQty, low_stock_threshold || 5, rack_location || null, now, now);
            }

            return sendSuccess(res, { branch_id, product_id, quantity: newQty }, 'Stock updated successfully');
        } catch (error) {
            console.error('[Branch Controller] Error adjusting stock:', error);
            return sendError(res, 'Failed to update branch stock', 500);
        }
    },

    // 8. POST /api/v1/branches/transfers - Inter-branch stock transfer
    createTransfer: async (req, res) => {
        try {
            const userId = req.user.id;
            const { from_branch_id, to_branch_id, items, notes } = req.body;

            if (!from_branch_id || !to_branch_id) {
                return sendError(res, 'Source and destination branches are required', 400);
            }
            if (from_branch_id === to_branch_id) {
                return sendError(res, 'Source and destination branch cannot be the same', 400);
            }
            if (!items || !Array.isArray(items) || items.length === 0) {
                return sendError(res, 'At least one item is required to transfer', 400);
            }

            const now = new Date().toISOString();
            const transferNo = `TRF-${Date.now().toString().slice(-6)}`;

            // Check availability in source branch
            for (const item of items) {
                const prodId = item.product_id || item.id;
                const transferQty = parseFloat(item.quantity) || 0;

                if (transferQty <= 0) continue;

                const stockRow = await db.prepare('SELECT quantity FROM branch_stock WHERE branch_id = ? AND product_id = ? AND user_id = ?')
                    .get(from_branch_id, prodId, userId);

                const avail = stockRow ? parseFloat(stockRow.quantity) || 0 : 0;
                if (transferQty > avail) {
                    return sendError(res, `Insufficient stock for "${item.name || 'Product'}". Available at source: ${avail}, requested: ${transferQty}`, 400);
                }
            }

            // Atomically transfer
            for (const item of items) {
                const prodId = item.product_id || item.id;
                const transferQty = parseFloat(item.quantity) || 0;
                if (transferQty <= 0) continue;

                // 1. Deduct from source branch
                await db.prepare(`
                    UPDATE branch_stock 
                    SET quantity = MAX(0, quantity - ?), updated_at = ? 
                    WHERE branch_id = ? AND product_id = ? AND user_id = ?
                `).run(transferQty, now, from_branch_id, prodId, userId);

                // 2. Add to destination branch
                const destRow = await db.prepare('SELECT id, quantity FROM branch_stock WHERE branch_id = ? AND product_id = ? AND user_id = ?')
                    .get(to_branch_id, prodId, userId);

                if (destRow) {
                    await db.prepare(`
                        UPDATE branch_stock 
                        SET quantity = quantity + ?, updated_at = ? 
                        WHERE id = ?
                    `).run(transferQty, now, destRow.id);
                } else {
                    await db.prepare(`
                        INSERT INTO branch_stock (user_id, branch_id, product_id, quantity, low_stock_threshold, created_at, updated_at)
                        VALUES (?, ?, ?, ?, 5, ?, ?)
                    `).run(userId, to_branch_id, prodId, transferQty, now, now);
                }
            }

            // Record transfer history
            const result = await db.prepare(`
                INSERT INTO branch_transfers (
                    user_id, transfer_no, from_branch_id, to_branch_id, status, items, notes, dispatched_at, received_at, created_at
                ) VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?)
            `).run(userId, transferNo, from_branch_id, to_branch_id, JSON.stringify(items), notes || '', now, now, now);

            return sendSuccess(res, {
                id: result.lastInsertRowid || result.id,
                transfer_no: transferNo,
                status: 'completed'
            }, 'Stock transfer executed successfully', 201);
        } catch (error) {
            console.error('[Branch Controller] Error transferring stock:', error);
            return sendError(res, 'Failed to transfer stock', 500);
        }
    },

    // 9. GET /api/v1/branches/transfers - Transfer history
    getTransfers: async (req, res) => {
        try {
            const userId = req.user.id;
            const transfers = await db.prepare(`
                SELECT 
                    t.*,
                    fb.name as from_branch_name,
                    fb.code as from_branch_code,
                    tb.name as to_branch_name,
                    tb.code as to_branch_code
                FROM branch_transfers t
                LEFT JOIN branches fb ON fb.id = t.from_branch_id
                LEFT JOIN branches tb ON tb.id = t.to_branch_id
                WHERE t.user_id = ?
                ORDER BY t.created_at DESC
                LIMIT 50
            `).all(userId);

            const parsed = transfers.map(t => {
                let items = [];
                try { items = JSON.parse(t.items); } catch(e) {}
                return { ...t, items };
            });

            return sendSuccess(res, parsed, 'Transfer history retrieved');
        } catch (error) {
            console.error('[Branch Controller] Error fetching transfers:', error);
            return sendError(res, 'Failed to fetch transfers', 500);
        }
    }
};

module.exports = branchController;
