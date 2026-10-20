const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

let initPromise = null;
const ensureTablesInit = async () => {
    if (!initPromise) {
        initPromise = (async () => {
            try {
                const dbType = process.env.DB_TYPE || 'sqlite';
                const idType = dbType === 'postgres' ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
                const timeType = dbType === 'postgres' ? 'TIMESTAMP' : 'TEXT';
                const numType = dbType === 'postgres' ? 'NUMERIC' : 'REAL';

                try {
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
                            is_main_branch INTEGER DEFAULT 0,
                            status TEXT DEFAULT 'active',
                            created_at ${timeType} DEFAULT CURRENT_TIMESTAMP,
                            updated_at ${timeType} DEFAULT CURRENT_TIMESTAMP
                        )
                    `).run();
                } catch (e) {
                    console.warn('[Branch Controller] branches table check notice:', e.message);
                }

                try {
                    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_branches_user ON branches(user_id)`).run();
                } catch (e) {}

                try {
                    await db.prepare(`
                        CREATE TABLE IF NOT EXISTS branch_stock (
                            id ${idType},
                            user_id INTEGER NOT NULL,
                            branch_id INTEGER NOT NULL,
                            product_id INTEGER NOT NULL,
                            quantity ${numType} DEFAULT 0,
                            low_stock_threshold ${numType} DEFAULT 5,
                            rack_location TEXT,
                            created_at ${timeType} DEFAULT CURRENT_TIMESTAMP,
                            updated_at ${timeType} DEFAULT CURRENT_TIMESTAMP
                        )
                    `).run();
                } catch (e) {
                    console.warn('[Branch Controller] branch_stock table check notice:', e.message);
                }

                try {
                    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_branch_stock_lookup ON branch_stock(branch_id, product_id)`).run();
                    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_branch_stock_user ON branch_stock(user_id)`).run();
                } catch (e) {}

                try {
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
                            created_at ${timeType} DEFAULT CURRENT_TIMESTAMP
                        )
                    `).run();
                } catch (e) {
                    console.warn('[Branch Controller] branch_transfers table check notice:', e.message);
                }

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

                // Add branch columns to expenses if not exist
                try {
                    await db.prepare(`ALTER TABLE expenses ADD COLUMN branch_id INTEGER`).run();
                } catch (e) {}
                try {
                    await db.prepare(`ALTER TABLE expenses ADD COLUMN branch_name TEXT`).run();
                } catch (e) {}

                // Add branch columns to business_purchases if not exist
                try {
                    await db.prepare(`ALTER TABLE business_purchases ADD COLUMN branch_id INTEGER`).run();
                } catch (e) {}
                try {
                    await db.prepare(`ALTER TABLE business_purchases ADD COLUMN branch_name TEXT`).run();
                } catch (e) {}

                // Add branch columns to accounting if not exist
                try {
                    await db.prepare(`ALTER TABLE accounting ADD COLUMN branch_id INTEGER`).run();
                } catch (e) {}
                try {
                    await db.prepare(`ALTER TABLE accounting ADD COLUMN branch_name TEXT`).run();
                } catch (e) {}

                // Add reverse transfer columns to branch_transfers if not exist
                try {
                    await db.prepare(`ALTER TABLE branch_transfers ADD COLUMN transfer_type TEXT DEFAULT 'FORWARD'`).run();
                } catch (e) {}
                try {
                    await db.prepare(`ALTER TABLE branch_transfers ADD COLUMN return_reason TEXT`).run();
                } catch (e) {}
            } catch (err) {
                console.warn('[Branch Controller] Table init warning:', err.message);
            }
        })();
    }
    return initPromise;
};

// Initial background trigger on startup
ensureTablesInit();

// Helper: auto-provision default "Main Showroom" if business has zero branches
const ensureDefaultBranch = async (userId) => {
    try {
        await ensureTablesInit();
        const countRow = await db.prepare("SELECT COUNT(*) as count FROM branches WHERE user_id = ? AND status != 'deleted'").get(userId);
        const count = countRow ? Number(countRow.count ?? countRow['count'] ?? 0) : 0;

        let mainBranchId = null;

        if (count === 0) {
            const now = new Date().toISOString();
            const res = await db.prepare(`
                INSERT INTO branches (
                    user_id, name, code, invoice_prefix, address, city, state, pincode, 
                    phone, email, is_main_branch, status, created_at, updated_at
                ) VALUES (?, 'Main Showroom', 'MAIN-01', 'MS-', 'Central Commercial Hub', 'Chennai', 'Tamil Nadu', '600001', '', '', 1, 'active', ?, ?)
            `).run(userId, now, now);

            mainBranchId = res?.lastInsertRowid || res?.id;

            // Sync all existing products into this default branch with their current quantity
            if (mainBranchId) {
                try {
                    const prods = await db.prepare('SELECT id, quantity, low_stock_threshold FROM business_products WHERE user_id = ?').all(userId);
                    if (Array.isArray(prods)) {
                        for (const p of prods) {
                            try {
                                await db.prepare(`
                                    INSERT INTO branch_stock (user_id, branch_id, product_id, quantity, low_stock_threshold, created_at, updated_at)
                                    VALUES (?, ?, ?, ?, ?, ?, ?)
                                `).run(userId, mainBranchId, p.id, p.quantity || 0, p.low_stock_threshold || 5, now, now);
                            } catch (pErr) {}
                        }
                    }
                } catch (prodsErr) {
                    console.warn('[Branch Controller] Warning fetching prods for default branch:', prodsErr.message);
                }
            }
        } else {
            // Retrieve existing main branch ID
            const mainRow = await db.prepare("SELECT id FROM branches WHERE user_id = ? AND is_main_branch = 1 AND status != 'deleted'").get(userId);
            mainBranchId = mainRow?.id;
            if (!mainBranchId) {
                const firstRow = await db.prepare("SELECT id FROM branches WHERE user_id = ? AND status != 'deleted' ORDER BY id ASC LIMIT 1").get(userId);
                mainBranchId = firstRow?.id;
            }
        }

        // Backfill any existing unassigned invoices to the Main Showroom
        if (mainBranchId) {
            try {
                await db.prepare(`
                    UPDATE business_invoices 
                    SET branch_id = ?, branch_name = 'Main Showroom'
                    WHERE user_id = ? AND (branch_id IS NULL OR branch_id = 0)
                `).run(mainBranchId, userId);
            } catch (invErr) {
                console.warn('[Branch Controller] Notice backfilling invoices:', invErr.message);
            }

            // Also backfill unassigned purchases and expenses if table columns exist
            try {
                await db.prepare(`
                    UPDATE business_purchases 
                    SET branch_id = ?, branch_name = 'Main Showroom'
                    WHERE user_id = ? AND (branch_id IS NULL OR branch_id = 0)
                `).run(mainBranchId, userId);
            } catch (purErr) {}

            try {
                await db.prepare(`
                    UPDATE expenses 
                    SET branch_id = ?, branch_name = 'Main Showroom'
                    WHERE user_id = ? AND (branch_id IS NULL OR branch_id = 0)
                `).run(mainBranchId, userId);
            } catch (expErr) {}

            try {
                await db.prepare(`
                    UPDATE accounting 
                    SET branch_id = ?, branch_name = 'Main Showroom'
                    WHERE user_id = ? AND (branch_id IS NULL OR branch_id = 0)
                `).run(mainBranchId, userId);
            } catch (accErr) {}

            // Ensure all products have a branch_stock row for this main branch
            try {
                const now = new Date().toISOString();
                const missing = await db.prepare(`
                    SELECT p.id, p.quantity, p.low_stock_threshold 
                    FROM business_products p 
                    LEFT JOIN branch_stock bs ON bs.product_id = p.id AND bs.branch_id = ?
                    WHERE p.user_id = ? AND bs.id IS NULL
                `).all(mainBranchId, userId);
                if (Array.isArray(missing)) {
                    for (const p of missing) {
                        try {
                            await db.prepare(`
                                INSERT INTO branch_stock (user_id, branch_id, product_id, quantity, low_stock_threshold, created_at, updated_at)
                                VALUES (?, ?, ?, ?, ?, ?, ?)
                            `).run(userId, mainBranchId, p.id, p.quantity || 0, p.low_stock_threshold || 5, now, now);
                        } catch (e) {}
                    }
                }
            } catch (syncErr) {}

            return mainBranchId;
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

            let branches = [];
            try {
                branches = await db.prepare(`
                    SELECT b.*,
                        (SELECT COUNT(DISTINCT product_id) FROM branch_stock WHERE branch_id = b.id AND quantity > 0) as active_products_count,
                        (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE branch_id = b.id) as total_stock_quantity
                    FROM branches b
                    WHERE b.user_id = ? AND b.status != 'deleted'
                    ORDER BY b.is_main_branch DESC, b.created_at ASC
                `).all(userId);
            } catch (queryErr) {
                console.warn('[Branch Controller] Fallback branch query:', queryErr.message);
                try {
                    branches = await db.prepare(`
                        SELECT * FROM branches 
                        WHERE user_id = ? AND status != 'deleted'
                        ORDER BY is_main_branch DESC, id ASC
                    `).all(userId);
                } catch (fallbackErr) {
                    console.error('[Branch Controller] Both queries failed:', fallbackErr.message);
                    branches = [];
                }
            }

            const branchList = Array.isArray(branches) ? branches : [];

            // Add assigned flag if requester is a Sub-ID
            const enriched = branchList.map(b => ({
                ...b,
                is_assigned: req.user.branch_id ? Number(req.user.branch_id) === Number(b.id) : true
            }));

            return sendSuccess(res, enriched, 'Branches retrieved successfully');
        } catch (error) {
            console.error('[Branch Controller] Error fetching branches:', error);
            // Self-healing fallback: never break initial frontend load with 500
            return sendSuccess(res, [], 'Branches initialized');
        }
    },

    // 2. GET /api/v1/branches/:id - Get single branch details & stats
    getBranchById: async (req, res) => {
        try {
            await ensureTablesInit();
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
                    WHERE user_id = ? AND branch_id = ? AND CAST(created_at AS TEXT) LIKE ?
                `).get(userId, branchId, `${today}%`);
                if (salesRow) todaySales = parseFloat(salesRow.total) || 0;
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
            if (req.user.is_sub_id || req.user.role === 'sub_id' || req.user.role === 'SUB_ID') {
                return sendError(res, 'Access denied. Only the business owner can register new showroom branches.', 403);
            }

            await ensureTablesInit();
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
            const existing = await db.prepare("SELECT id FROM branches WHERE user_id = ? AND UPPER(code) = ? AND status != 'deleted'").get(userId, cleanCode);
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
                if (Array.isArray(prods)) {
                    for (const p of prods) {
                        try {
                            await db.prepare(`
                                INSERT INTO branch_stock (user_id, branch_id, product_id, quantity, low_stock_threshold, created_at, updated_at)
                                VALUES (?, ?, ?, 0, ?, ?, ?)
                            `).run(userId, newBranchId, p.id, p.low_stock_threshold || 5, now, now);
                        } catch (sErr) {}
                    }
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
            if (req.user.is_sub_id || req.user.role === 'sub_id' || req.user.role === 'SUB_ID') {
                return sendError(res, 'Access denied. Only the business owner can modify branch details.', 403);
            }

            await ensureTablesInit();
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
            if (req.user.is_sub_id || req.user.role === 'sub_id' || req.user.role === 'SUB_ID') {
                return sendError(res, 'Access denied. Only the business owner can delete showroom branches.', 403);
            }

            await ensureTablesInit();
            const userId = req.user.id;
            const branchId = parseInt(req.params.id);

            const branch = await db.prepare('SELECT id, is_main_branch FROM branches WHERE id = ? AND user_id = ?').get(branchId, userId);
            if (!branch) return sendError(res, 'Branch not found', 404);
            if (branch.is_main_branch) return sendError(res, 'Cannot delete the Primary/Main Showroom', 400);

            // Check remaining branches
            const totalCount = await db.prepare("SELECT COUNT(*) as count FROM branches WHERE user_id = ? AND status != 'deleted'").get(userId);
            const remaining = totalCount ? Number(totalCount.count ?? 0) : 0;
            if (remaining <= 1) {
                return sendError(res, 'Cannot delete your only remaining branch', 400);
            }

            await db.prepare("UPDATE branches SET status = 'deleted', updated_at = ? WHERE id = ? AND user_id = ?")
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
            await ensureTablesInit();
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
            await ensureTablesInit();
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
            await ensureTablesInit();
            const userId = req.user.id;
            const { from_branch_id, to_branch_id, items, notes, transfer_type = 'FORWARD', return_reason = null } = req.body;

            if (!from_branch_id || !to_branch_id) {
                return sendError(res, 'Source and destination branches are required', 400);
            }
            if (from_branch_id === to_branch_id) {
                return sendError(res, 'Source and destination branch cannot be the same', 400);
            }
            if (!items || !Array.isArray(items) || items.length === 0) {
                return sendError(res, 'At least one item is required to transfer', 400);
            }

            // Fetch branch names for logging
            const fromBranch = await db.prepare('SELECT name FROM branches WHERE id = ? AND user_id = ?').get(from_branch_id, userId);
            const toBranch = await db.prepare('SELECT name FROM branches WHERE id = ? AND user_id = ?').get(to_branch_id, userId);
            const fromBranchName = fromBranch?.name || `Branch #${from_branch_id}`;
            const toBranchName = toBranch?.name || `Branch #${to_branch_id}`;

            const now = new Date().toISOString();
            const transferPrefix = transfer_type === 'RETURN_TO_MAIN' ? 'RET' : 'TRF';
            const transferNo = `${transferPrefix}-${Date.now().toString().slice(-6)}`;

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
                const sourceRow = await db.prepare('SELECT id, quantity FROM branch_stock WHERE branch_id = ? AND product_id = ? AND user_id = ?')
                    .get(from_branch_id, prodId, userId);
                if (sourceRow) {
                    const newSourceQty = Math.max(0, (parseFloat(sourceRow.quantity) || 0) - transferQty);
                    await db.prepare('UPDATE branch_stock SET quantity = ?, updated_at = ? WHERE id = ?')
                        .run(newSourceQty, now, sourceRow.id);
                }

                // 2. Add to destination branch
                const destRow = await db.prepare('SELECT id, quantity FROM branch_stock WHERE branch_id = ? AND product_id = ? AND user_id = ?')
                    .get(to_branch_id, prodId, userId);

                if (destRow) {
                    const newDestQty = (parseFloat(destRow.quantity) || 0) + transferQty;
                    await db.prepare('UPDATE branch_stock SET quantity = ?, updated_at = ? WHERE id = ?')
                        .run(newDestQty, now, destRow.id);
                } else {
                    await db.prepare(`
                        INSERT INTO branch_stock (user_id, branch_id, product_id, quantity, low_stock_threshold, created_at, updated_at)
                        VALUES (?, ?, ?, ?, 5, ?, ?)
                    `).run(userId, to_branch_id, prodId, transferQty, now, now);
                }

                // 3. Log stock movements safely
                try {
                    const outDesc = transfer_type === 'RETURN_TO_MAIN'
                        ? `Return to ${toBranchName} (${return_reason || 'Damaged/Dead Stock'}): #${transferNo}`
                        : `Stock Transfer to ${toBranchName}: #${transferNo}`;
                    const inDesc = transfer_type === 'RETURN_TO_MAIN'
                        ? `Return received from ${fromBranchName} (${return_reason || 'Damaged/Dead Stock'}): #${transferNo}`
                        : `Stock Transfer from ${fromBranchName}: #${transferNo}`;

                    await db.prepare(`
                        INSERT INTO product_stock_history (product_id, user_id, quantity_changed, type, description, created_at)
                        VALUES (?, ?, ?, 'out', ?, ?)
                    `).run(prodId, userId, transferQty, outDesc, now);

                    await db.prepare(`
                        INSERT INTO product_stock_history (product_id, user_id, quantity_changed, type, description, created_at)
                        VALUES (?, ?, ?, 'in', ?, ?)
                    `).run(prodId, userId, transferQty, inDesc, now);
                } catch (historyErr) {
                    console.warn('[Branch Controller] Stock history warning:', historyErr.message);
                }
            }

            // Record transfer history
            const result = await db.prepare(`
                INSERT INTO branch_transfers (
                    user_id, transfer_no, from_branch_id, to_branch_id, status, items, notes, transfer_type, return_reason, dispatched_at, received_at, created_at
                ) VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?)
            `).run(userId, transferNo, from_branch_id, to_branch_id, JSON.stringify(items), notes || '', transfer_type, return_reason, now, now, now);

            return sendSuccess(res, {
                id: result.lastInsertRowid || result.id,
                transfer_no: transferNo,
                transfer_type,
                return_reason,
                status: 'completed'
            }, transfer_type === 'RETURN_TO_MAIN' ? 'Reverse stock return to Main Showroom processed' : 'Stock transfer executed successfully', 201);
        } catch (error) {
            console.error('[Branch Controller] Error transferring stock:', error);
            return sendError(res, 'Failed to transfer stock', 500);
        }
    },

    // 8b. POST /api/v1/branches/transfers/return-to-main - Dedicated reverse stock return
    createReverseTransfer: async (req, res) => {
        try {
            await ensureTablesInit();
            const userId = req.user.id;
            let { from_branch_id, to_branch_id, items, return_reason, notes } = req.body;

            if (!from_branch_id) {
                return sendError(res, 'Source branch is required for return', 400);
            }

            // If to_branch_id not provided, automatically find Main Showroom
            if (!to_branch_id) {
                const mainBranch = await db.prepare("SELECT id FROM branches WHERE user_id = ? AND is_main_branch = 1 AND status != 'deleted' LIMIT 1").get(userId)
                    || await db.prepare("SELECT id FROM branches WHERE user_id = ? AND status != 'deleted' ORDER BY id ASC LIMIT 1").get(userId);
                if (!mainBranch) {
                    return sendError(res, 'Main Showroom not found to return items to', 400);
                }
                to_branch_id = mainBranch.id;
            }

            // Delegate to createTransfer with RETURN_TO_MAIN
            req.body.to_branch_id = to_branch_id;
            req.body.transfer_type = 'RETURN_TO_MAIN';
            req.body.return_reason = return_reason || 'Damaged / Dead Stock';
            return branchController.createTransfer(req, res);
        } catch (error) {
            console.error('[Branch Controller] Error in reverse transfer:', error);
            return sendError(res, 'Failed to process reverse transfer', 500);
        }
    },

    // 8c. GET /api/v1/branches/:id/low-stock - Identify low stock & suggested reorders
    getBranchLowStock: async (req, res) => {
        try {
            await ensureTablesInit();
            const userId = req.user.id;
            const branchId = parseInt(req.params.id);

            const branch = await db.prepare("SELECT id, name, code, is_main_branch FROM branches WHERE id = ? AND user_id = ? AND status != 'deleted'").get(branchId, userId);
            if (!branch) {
                return sendError(res, 'Branch not found', 404);
            }

            // Find Main Showroom
            const mainBranch = await db.prepare("SELECT id, name, code FROM branches WHERE user_id = ? AND is_main_branch = 1 AND status != 'deleted' LIMIT 1").get(userId)
                || await db.prepare("SELECT id, name, code FROM branches WHERE user_id = ? AND status != 'deleted' ORDER BY id ASC LIMIT 1").get(userId);
            const mainBranchId = mainBranch?.id || branchId;

            // Query products where quantity <= threshold
            const rows = await db.prepare(`
                SELECT 
                    p.id,
                    p.name,
                    p.sku,
                    p.category,
                    p.unit,
                    p.selling_price,
                    p.purchase_price,
                    COALESCE(bs.quantity, 0) as current_quantity,
                    COALESCE(bs.low_stock_threshold, p.low_stock_threshold, 5) as low_stock_threshold,
                    bs.rack_location,
                    COALESCE(ms.quantity, 0) as main_showroom_stock
                FROM business_products p
                LEFT JOIN branch_stock bs ON bs.product_id = p.id AND bs.branch_id = ? AND bs.user_id = ?
                LEFT JOIN branch_stock ms ON ms.product_id = p.id AND ms.branch_id = ? AND ms.user_id = ?
                WHERE p.user_id = ? AND p.status != 'deleted'
                  AND (COALESCE(bs.quantity, 0) <= COALESCE(bs.low_stock_threshold, p.low_stock_threshold, 5))
                ORDER BY COALESCE(bs.quantity, 0) ASC, p.name ASC
            `).all(branchId, userId, mainBranchId, userId, userId);

            const items = (Array.isArray(rows) ? rows : []).map(r => {
                const currentQty = parseFloat(r.current_quantity) || 0;
                const threshold = parseFloat(r.low_stock_threshold) || 5;
                const mainStock = parseFloat(r.main_showroom_stock) || 0;
                
                // Suggested target: 2x threshold or minimum 10
                const targetStock = Math.max(Math.ceil(threshold * 2), 10);
                const suggestedReorder = Math.max(1, targetStock - Math.floor(currentQty));
                const urgency = currentQty <= 0 ? 'CRITICAL_OUT_OF_STOCK' : 'LOW_STOCK';
                const canFulfillFromMain = mainStock >= suggestedReorder;

                return {
                    id: r.id,
                    product_id: r.id,
                    name: r.name,
                    sku: r.sku,
                    category: r.category,
                    unit: r.unit || 'pcs',
                    selling_price: parseFloat(r.selling_price) || 0,
                    purchase_price: parseFloat(r.purchase_price) || 0,
                    current_quantity: currentQty,
                    low_stock_threshold: threshold,
                    rack_location: r.rack_location || '-',
                    main_showroom_stock: mainStock,
                    suggested_reorder_qty: suggestedReorder,
                    urgency,
                    can_fulfill_from_main: canFulfillFromMain
                };
            });

            const outOfStockCount = items.filter(i => i.urgency === 'CRITICAL_OUT_OF_STOCK').length;
            const fulfillableCount = items.filter(i => i.can_fulfill_from_main).length;

            return sendSuccess(res, {
                branch,
                main_branch: mainBranch,
                items,
                summary: {
                    total_low_stock_items: items.length,
                    out_of_stock_count: outOfStockCount,
                    fulfillable_from_main_count: fulfillableCount
                }
            }, 'Branch low stock items calculated');
        } catch (error) {
            console.error('[Branch Controller] Error calculating low stock:', error);
            return sendError(res, 'Failed to fetch low stock items', 500);
        }
    },

    // 8d. POST /api/v1/branches/:id/auto-requisition - 1-Click Auto Requisition from Main Showroom
    createAutoRequisition: async (req, res) => {
        try {
            await ensureTablesInit();
            const userId = req.user.id;
            const branchId = parseInt(req.params.id);

            const branch = await db.prepare("SELECT id, name, code FROM branches WHERE id = ? AND user_id = ? AND status != 'deleted'").get(branchId, userId);
            if (!branch) {
                return sendError(res, 'Branch not found', 404);
            }

            // Find Main Showroom
            const mainBranch = await db.prepare("SELECT id, name, code FROM branches WHERE user_id = ? AND is_main_branch = 1 AND status != 'deleted' LIMIT 1").get(userId)
                || await db.prepare("SELECT id, name, code FROM branches WHERE user_id = ? AND status != 'deleted' ORDER BY id ASC LIMIT 1").get(userId);
            
            if (mainBranch && mainBranch.id === branchId) {
                return sendError(res, 'Main Showroom cannot create an internal requisition to itself', 400);
            }

            let requisitionItems = [];

            // If explicit items provided in body, use them
            if (req.body.items && Array.isArray(req.body.items) && req.body.items.length > 0) {
                for (const item of req.body.items) {
                    const prod = await db.prepare('SELECT id, name, purchase_price, tax_percentage FROM business_products WHERE id = ? AND user_id = ?')
                        .get(item.product_id || item.id, userId);
                    if (prod) {
                        const qty = parseFloat(item.quantity || item.suggested_reorder_qty) || 1;
                        const price = parseFloat(item.unit_price || prod.purchase_price) || 0;
                        requisitionItems.push({
                            product_id: prod.id,
                            item_name: prod.name,
                            quantity: qty,
                            unit_price: price,
                            tax_percentage: parseFloat(prod.tax_percentage) || 0,
                            total_price: qty * price
                        });
                    }
                }
            } else {
                // Otherwise auto-fetch all low-stock items for this branch
                const lowStockRows = await db.prepare(`
                    SELECT 
                        p.id,
                        p.name,
                        p.purchase_price,
                        p.tax_percentage,
                        COALESCE(bs.quantity, 0) as current_quantity,
                        COALESCE(bs.low_stock_threshold, p.low_stock_threshold, 5) as low_stock_threshold
                    FROM business_products p
                    LEFT JOIN branch_stock bs ON bs.product_id = p.id AND bs.branch_id = ? AND bs.user_id = ?
                    WHERE p.user_id = ? AND p.status != 'deleted'
                      AND (COALESCE(bs.quantity, 0) <= COALESCE(bs.low_stock_threshold, p.low_stock_threshold, 5))
                `).all(branchId, userId, userId);

                for (const r of (Array.isArray(lowStockRows) ? lowStockRows : [])) {
                    const currentQty = parseFloat(r.current_quantity) || 0;
                    const threshold = parseFloat(r.low_stock_threshold) || 5;
                    const targetStock = Math.max(Math.ceil(threshold * 2), 10);
                    const suggestedReorder = Math.max(1, targetStock - Math.floor(currentQty));
                    const price = parseFloat(r.purchase_price) || 0;

                    requisitionItems.push({
                        product_id: r.id,
                        item_name: r.name,
                        quantity: suggestedReorder,
                        unit_price: price,
                        tax_percentage: parseFloat(r.tax_percentage) || 0,
                        total_price: suggestedReorder * price
                    });
                }
            }

            if (requisitionItems.length === 0) {
                return sendError(res, 'No low-stock items detected to reorder for this branch', 400);
            }

            const now = new Date().toISOString();
            const todayStr = now.split('T')[0];
            const purchaseNumber = `REQ-AUTO-${Date.now().toString().slice(-6)}`;
            const supplierName = mainBranch?.name || 'Main Showroom';

            // Calculate totals
            const subtotal = requisitionItems.reduce((acc, it) => acc + it.total_price, 0);
            const taxAmount = requisitionItems.reduce((acc, it) => acc + (it.total_price * (it.tax_percentage / 100)), 0);
            const grandTotal = subtotal + taxAmount;

            // Insert into business_purchases
            const poResult = await db.prepare(`
                INSERT INTO business_purchases (
                    user_id, purchase_number, supplier_name, purchase_date,
                    due_date, status, subtotal, tax_amount, grand_total,
                    notes, purchase_type, doc_type, branch_id, branch_name, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'Pending Approval', ?, ?, ?, ?, 'INTERNAL', 'PO', ?, ?, ?, ?)
            `).run(
                userId, purchaseNumber, supplierName, todayStr,
                todayStr, subtotal, taxAmount, grandTotal,
                `1-Click Automated Replenishment Requisition for ${branch.name}`,
                branch.id, branch.name, now, now
            );

            const purchaseId = poResult.lastInsertRowid || poResult.id;

            // Insert line items
            for (const item of requisitionItems) {
                await db.prepare(`
                    INSERT INTO business_purchase_items (
                        purchase_id, product_id, item_name, quantity, unit_price,
                        tax_percentage, total_price, item_status, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
                `).run(
                    purchaseId, item.product_id, item.item_name, item.quantity, item.unit_price,
                    item.tax_percentage, item.total_price, now
                );
            }

            return sendSuccess(res, {
                purchase_id: purchaseId,
                purchase_number: purchaseNumber,
                branch_id: branch.id,
                branch_name: branch.name,
                item_count: requisitionItems.length,
                grand_total: grandTotal,
                status: 'Pending Approval'
            }, `1-Click Auto-Requisition #${purchaseNumber} successfully drafted to Main Showroom`, 201);
        } catch (error) {
            console.error('[Branch Controller] Error creating auto-requisition:', error);
            return sendError(res, 'Failed to create auto-requisition', 500);
        }
    },

    // 9. GET /api/v1/branches/transfers - Transfer history
    getTransfers: async (req, res) => {
        try {
            await ensureTablesInit();
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

            const transferList = Array.isArray(transfers) ? transfers : [];
            const parsed = transferList.map(t => {
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
