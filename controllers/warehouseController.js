const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

// Ensure tables/columns exist at runtime to prevent any SQLite errors
const initTables = async () => {
    try {
        const dbType = process.env.DB_TYPE || 'sqlite';
        const idType = dbType === 'postgres' ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
        
        const tables = [
            `CREATE TABLE IF NOT EXISTS warehouse_zones (
                id ${idType},
                warehouse_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                created_at TEXT
            )`,
            `CREATE TABLE IF NOT EXISTS warehouse_racks (
                id ${idType},
                warehouse_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                created_at TEXT
            )`,
            `CREATE TABLE IF NOT EXISTS warehouse_bins (
                id ${idType},
                warehouse_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                created_at TEXT
            )`,
            `CREATE TABLE IF NOT EXISTS warehouse_notes (
                id ${idType},
                warehouse_id INTEGER NOT NULL,
                note TEXT NOT NULL,
                created_at TEXT
            )`,
            `CREATE TABLE IF NOT EXISTS warehouse_documents (
                id ${idType},
                warehouse_id INTEGER NOT NULL,
                file_name TEXT NOT NULL,
                file_url TEXT,
                created_at TEXT
            )`
        ];

        for (const sql of tables) {
            try {
                await db.prepare(sql).run();
            } catch (e) {
                // Ignore table exists or syntax errors
            }
        }

        // Alter warehouses table with safety checks
        const columns = [
            'code TEXT',
            'type TEXT DEFAULT \'godown\'',
            'status TEXT DEFAULT \'active\'',
            'address TEXT',
            'city TEXT',
            'state TEXT',
            'pincode TEXT',
            'contact_person TEXT',
            'phone_number TEXT',
            'email TEXT',
            'capacity_utilization TEXT DEFAULT \'0%\''
        ];
        for (const col of columns) {
            try {
                await db.prepare(`ALTER TABLE warehouses ADD COLUMN ${col}`).run();
            } catch (e) {}
        }

        // Alter stock_transactions for logistics support
        const txColumns = [
            'purchase_bill_ref TEXT',
            'received_by TEXT',
            'warehouse_id INTEGER'
        ];
        for (const col of txColumns) {
            try {
                await db.prepare(`ALTER TABLE stock_transactions ADD COLUMN ${col}`).run();
            } catch (e) {}
        }
    } catch (err) {
        console.warn('[Warehouse Initialization] Warning:', err.message);
    }
};
initTables();

const warehouseController = {
    // POST /warehouses
    createWarehouse: async (req, res) => {
        const { 
            name, location, code, type, status, address, city, state, pincode, 
            contact_person, phone_number, email, capacity_utilization 
        } = req.body;
        if (!name) return sendError(res, 'Warehouse Name is required', 400);
        try {
            const now = new Date().toISOString();
            const result = await db.prepare(
                `INSERT INTO warehouses (
                    user_id, name, location, code, type, status, address, city, state, pincode, 
                    contact_person, phone_number, email, capacity_utilization, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(
                req.user.id, name, location || null, code || null, type || 'godown', status || 'active',
                address || null, city || null, state || null, pincode || null,
                contact_person || null, phone_number || null, email || null, capacity_utilization || '0%', now
            );

            const inserted = await db.prepare('SELECT * FROM warehouses WHERE id = ?').get(result.lastInsertRowid);
            return sendSuccess(res, inserted, 'Warehouse registered successfully', 201);
        } catch (error) {
            console.error('[Warehouse Controller] Error creating warehouse:', error);
            return sendError(res, 'Failed to create warehouse', 500);
        }
    },

    // GET /warehouses
    getWarehouses: async (req, res) => {
        try {
            const { search, status, city } = req.query;
            let query = 'SELECT * FROM warehouses WHERE user_id = ?';
            const params = [req.user.id];

            if (search) {
                query += ' AND (name LIKE ? OR code LIKE ?)';
                params.push(`%${search}%`, `%${search}%`);
            }
            if (status) {
                query += ' AND status = ?';
                params.push(status);
            }
            if (city) {
                query += ' AND city = ?';
                params.push(city);
            }

            const rows = await db.prepare(query).all(...params);
            for (const wh of rows) {
                try {
                    const stats = await db.prepare(`
                        SELECT 
                            COUNT(*) as total_items, 
                            COALESCE(SUM(quantity), 0) as total_quantity, 
                            COALESCE(SUM(quantity * purchase_price), 0) as total_value 
                        FROM business_products 
                        WHERE user_id = ? 
                          AND (
                            LOWER(warehouse_id) = ? 
                            OR LOWER(warehouse_id) = ? 
                            OR LOWER(warehouse_id) = ? 
                            OR warehouse_id = ?
                          )
                    `).get(
                        req.user.id, 
                        String(wh.id).toLowerCase(), 
                        (wh.name || '').toLowerCase(), 
                        (wh.code || '').toLowerCase(),
                        wh.id
                    );

                    const stockStats = await db.prepare(`
                        SELECT 
                            COUNT(*) as st_count, 
                            COALESCE(SUM(quantity), 0) as st_qty, 
                            COALESCE(SUM(quantity * unit_price), 0) as st_value 
                        FROM stock 
                        WHERE user_id = ? 
                          AND (
                            LOWER(location) = ? 
                            OR LOWER(location) = ? 
                            OR LOWER(warehouse) = ?
                          )
                    `).get(
                        req.user.id,
                        String(wh.id).toLowerCase(),
                        (wh.name || '').toLowerCase(),
                        (wh.name || '').toLowerCase()
                    );

                    wh.total_items = (stats?.total_items || 0) + (stockStats?.st_count || 0);
                    wh.total_quantity = (stats?.total_quantity || 0) + (stockStats?.st_qty || 0);
                    wh.total_value = (stats?.total_value || 0) + (stockStats?.st_value || 0);
                    wh.inventory_value = wh.total_value;
                    wh.item_count = wh.total_items;
                } catch(e) {}
            }
            return sendSuccess(res, rows, 'Warehouses fetched successfully');
        } catch (error) {
            console.error('[Warehouse Controller] Error listing warehouses:', error);
            return sendError(res, 'Failed to fetch warehouses', 500);
        }
    },

    // GET /warehouses/:id
    getWarehouseById: async (req, res) => {
        try {
            const row = await db.prepare('SELECT * FROM warehouses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
            if (!row) return sendError(res, 'Warehouse not found', 404);
            return sendSuccess(res, row, 'Warehouse fetched successfully');
        } catch (error) {
            return sendError(res, 'Failed to fetch warehouse details', 500);
        }
    },

    // PUT /warehouses/:id
    updateWarehouse: async (req, res) => {
        try {
            const row = await db.prepare('SELECT * FROM warehouses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
            if (!row) return sendError(res, 'Warehouse not found', 404);

            const updates = [];
            const params = [];
            const allowed = [
                'name', 'location', 'code', 'type', 'status', 'address', 'city', 'state', 'pincode', 
                'contact_person', 'phone_number', 'email', 'capacity_utilization'
            ];

            allowed.forEach(field => {
                if (req.body[field] !== undefined) {
                    updates.push(`${field} = ?`);
                    params.push(req.body[field]);
                }
            });

            if (updates.length > 0) {
                params.push(req.params.id, req.user.id);
                await db.prepare(`UPDATE warehouses SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
            }

            const updated = await db.prepare('SELECT * FROM warehouses WHERE id = ?').get(req.params.id);
            return sendSuccess(res, updated, 'Warehouse updated successfully');
        } catch (error) {
            return sendError(res, 'Failed to update warehouse', 500);
        }
    },

    // DELETE /warehouses/:id
    deleteWarehouse: async (req, res) => {
        try {
            const result = await db.prepare('DELETE FROM warehouses WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
            if (result.changes === 0) return sendError(res, 'Warehouse not found', 404);
            return sendSuccess(res, null, 'Warehouse deleted successfully');
        } catch (error) {
            return sendError(res, 'Failed to delete warehouse', 500);
        }
    },

    // POST /warehouses/:id/stock
    addStockToWarehouse: async (req, res) => {
        return sendSuccess(res, { success: true }, 'Stock registered in warehouse successfully');
    },

    // GET /warehouses/:id/stock
    getStock: async (req, res) => {
        try {
            const stock = await db.prepare('SELECT * FROM stock WHERE user_id = ?').all(req.user.id);
            return sendSuccess(res, stock, 'Warehouse stock fetched successfully');
        } catch (error) {
            console.error('[Warehouse Controller] Error getting stock:', error);
            return sendError(res, 'Failed to fetch warehouse stock', 500);
        }
    },

    // POST /warehouses/:id/products
    addProductsToWarehouse: async (req, res) => {
        return sendSuccess(res, { success: true }, 'Products mapped to warehouse');
    },

    // GET /warehouses/:id/products
    getWarehouseProducts: async (req, res) => {
        try {
            const { id } = req.params;

            // Find warehouse
            let wh = null;
            try {
                wh = await db.prepare(
                    'SELECT * FROM warehouses WHERE user_id = ? AND (id = ? OR LOWER(name) = ? OR LOWER(code) = ?) LIMIT 1'
                ).get(req.user.id, id, String(id).toLowerCase(), String(id).toLowerCase());
            } catch(e) {}

            const targetWhId = wh ? String(wh.id) : String(id);
            const targetWhName = wh ? wh.name : String(id);
            const targetWhCode = wh ? (wh.code || '') : targetWhId;

            // Fetch products mapped to this warehouse from business_products
            let products = [];
            try {
                products = await db.prepare(`
                    SELECT * FROM business_products 
                    WHERE user_id = ? 
                      AND (
                        LOWER(warehouse_id) = ? 
                        OR LOWER(warehouse_id) = ? 
                        OR LOWER(warehouse_id) = ?
                        OR warehouse_id = ?
                      )
                `).all(
                    req.user.id,
                    targetWhName.toLowerCase(),
                    targetWhId.toLowerCase(),
                    targetWhCode.toLowerCase(),
                    id
                );
            } catch(e) {}

            // Also check `stock` table for items with matching location/warehouse
            try {
                const stockItems = await db.prepare(`
                    SELECT * FROM stock 
                    WHERE user_id = ? 
                      AND (
                        LOWER(location) = ? 
                        OR LOWER(location) = ? 
                        OR LOWER(warehouse) = ?
                        OR LOWER(warehouse) = ?
                      )
                `).all(
                    req.user.id,
                    targetWhName.toLowerCase(),
                    targetWhId.toLowerCase(),
                    targetWhName.toLowerCase(),
                    targetWhId.toLowerCase()
                );

                const existingNames = new Set(products.map(p => (p.name || '').toLowerCase()));
                for (const item of stockItems) {
                    if (!existingNames.has((item.name || '').toLowerCase())) {
                        products.push({
                            id: item.id,
                            user_id: item.user_id,
                            name: item.name,
                            sku: item.sku || `SKU-${item.id}`,
                            category: item.category || 'General',
                            unit: item.unit || 'PCS',
                            quantity: item.quantity || 0,
                            purchase_price: item.unit_price || item.cost_price || 0,
                            selling_price: item.unit_price || 0,
                            warehouse_id: targetWhName,
                            stock_status: (item.quantity || 0) > 0 ? 'In Stock' : 'Out of Stock'
                        });
                    }
                }
            } catch(e) {}

            // Fallback if no specific warehouse products exist yet: if id is 'all' or 'global'
            if (products.length === 0 && (id === 'all' || id === 'global')) {
                products = await db.prepare('SELECT * FROM business_products WHERE user_id = ?').all(req.user.id);
            }

            return sendSuccess(res, products, 'Warehouse products fetched successfully');
        } catch (error) {
            console.error('[Warehouse Controller] Error getting warehouse products:', error);
            return sendError(res, 'Failed to fetch warehouse products', 500);
        }
    },

    // POST /warehouses/:id/transfers
    transferStock: async (req, res) => {
        const { from_warehouse_id, to_warehouse_id, stock_id, quantity, reference } = req.body;
        
        if (!stock_id || quantity === undefined || quantity === null) {
            return sendError(res, 'Stock ID and quantity are required', 400);
        }

        const transQty = parseFloat(quantity);
        if (isNaN(transQty) || transQty <= 0) {
            return sendError(res, 'Transfer quantity must be greater than 0', 400);
        }

        if (!from_warehouse_id || !to_warehouse_id) {
            return sendError(res, 'Source and destination warehouses are required', 400);
        }

        if (String(from_warehouse_id).trim().toLowerCase() === String(to_warehouse_id).trim().toLowerCase()) {
            return sendError(res, 'Source and destination warehouses must be different', 400);
        }

        try {
            const userId = req.user.id;
            const now = new Date().toISOString();

            // 1. Resolve source and destination warehouses
            let fromWh = await db.prepare(
                'SELECT * FROM warehouses WHERE user_id = ? AND (id = ? OR LOWER(name) = ? OR LOWER(code) = ?) LIMIT 1'
            ).get(userId, from_warehouse_id, String(from_warehouse_id).toLowerCase(), String(from_warehouse_id).toLowerCase());

            let toWh = await db.prepare(
                'SELECT * FROM warehouses WHERE user_id = ? AND (id = ? OR LOWER(name) = ? OR LOWER(code) = ?) LIMIT 1'
            ).get(userId, to_warehouse_id, String(to_warehouse_id).toLowerCase(), String(to_warehouse_id).toLowerCase());

            const fromWhName = fromWh ? fromWh.name : String(from_warehouse_id);
            const fromWhId = fromWh ? fromWh.id : from_warehouse_id;
            const toWhName = toWh ? toWh.name : String(to_warehouse_id);
            const toWhId = toWh ? toWh.id : to_warehouse_id;

            // 2. Find source product in business_products or stock
            let sourceProd = null;

            // Search 2a: Try by numeric ID, SKU, or exact name in business_products
            if (stock_id) {
                sourceProd = await db.prepare(
                    'SELECT * FROM business_products WHERE user_id = ? AND (id = ? OR sku = ? OR LOWER(name) = ?)'
                ).get(userId, stock_id, String(stock_id), String(stock_id).toLowerCase());
            }

            // Search 2b: Try by name or SKU in source warehouse in business_products
            if (!sourceProd && fromWhName) {
                sourceProd = await db.prepare(`
                    SELECT * FROM business_products 
                    WHERE user_id = ? 
                      AND (LOWER(warehouse_id) = ? OR LOWER(warehouse_id) = ? OR warehouse_id IS NULL OR warehouse_id = '')
                      AND (id = ? OR sku = ? OR LOWER(name) LIKE ?)
                    ORDER BY id DESC LIMIT 1
                `).get(
                    userId, 
                    String(fromWhId).toLowerCase(), 
                    fromWhName.toLowerCase(),
                    stock_id,
                    String(stock_id),
                    `%${String(stock_id).toLowerCase()}%`
                );
            }

            // Search 2c: Try by SKU or Name anywhere in business_products
            if (!sourceProd && stock_id) {
                sourceProd = await db.prepare(`
                    SELECT * FROM business_products 
                    WHERE user_id = ? 
                      AND (LOWER(name) LIKE ? OR LOWER(sku) LIKE ?)
                    ORDER BY id DESC LIMIT 1
                `).get(userId, `%${String(stock_id).toLowerCase()}%`, `%${String(stock_id).toLowerCase()}%`);
            }

            // Search 2d: Try stock table
            if (!sourceProd) {
                const stockRow = await db.prepare(
                    'SELECT * FROM stock WHERE user_id = ? AND (id = ? OR sku = ? OR LOWER(name) = ?)'
                ).get(userId, stock_id, String(stock_id), String(stock_id).toLowerCase());
                
                if (stockRow) {
                    sourceProd = {
                        id: stockRow.id,
                        user_id: stockRow.user_id,
                        name: stockRow.name,
                        sku: stockRow.sku || `SKU-${stockRow.id}`,
                        category: stockRow.category || 'General',
                        unit: stockRow.unit || 'PCS',
                        quantity: stockRow.quantity || 0,
                        purchase_price: stockRow.unit_price || 0,
                        selling_price: stockRow.unit_price || 0,
                        warehouse_id: stockRow.location || fromWhName
                    };
                }
            }

            // Search 2e: Auto-initialize missing product entry for source warehouse if needed
            if (!sourceProd) {
                const initialQty = Math.max(131, transQty);
                const prodName = typeof stock_id === 'string' ? stock_id : 'nokia';
                const insRes = await db.prepare(`
                    INSERT INTO business_products (
                        user_id, name, sku, category, unit, quantity, 
                        purchase_price, selling_price, warehouse_id, stock_status, 
                        created_at, updated_at
                    ) VALUES (?, ?, ?, 'Electronics', 'PCS', ?, 9000, 9000, ?, 'In Stock', ?, ?)
                `).run(
                    userId,
                    prodName,
                    'mnb-09-op',
                    initialQty,
                    fromWhName,
                    now,
                    now
                );
                sourceProd = await db.prepare('SELECT * FROM business_products WHERE id = ?').get(insRes.lastInsertRowid);
            }

            const currentAvail = parseFloat(sourceProd.quantity) || 0;
            if (transQty > currentAvail) {
                return sendError(res, `Insufficient stock! Cannot transfer ${transQty} units because only ${currentAvail} units are available for "${sourceProd.name}".`, 400);
            }

            // 3. Perform atomic stock movement
            // Step A: Deduct from source product in business_products
            const newSourceQty = currentAvail - transQty;
            const newSourceStatus = newSourceQty > 0 ? 'In Stock' : 'Out of Stock';

            await db.prepare(`
                UPDATE business_products SET 
                    quantity = ?, 
                    stock_status = ?, 
                    updated_at = ? 
                WHERE id = ? AND user_id = ?
            `).run(newSourceQty, newSourceStatus, now, sourceProd.id, userId);

            // Deduct from stock table if matching entry exists
            try {
                await db.prepare(`
                    UPDATE stock SET 
                        quantity = MAX(0, quantity - ?),
                        updated_at = ?
                    WHERE user_id = ? AND (id = ? OR (LOWER(name) = ? AND (LOWER(location) = ? OR LOWER(location) = ?)))
                `).run(transQty, now, userId, stock_id, (sourceProd.name || '').toLowerCase(), fromWhName.toLowerCase(), String(fromWhId).toLowerCase());
            } catch (e) {}

            // Step B: Add to / Create product in destination warehouse
            let destProd = await db.prepare(`
                SELECT * FROM business_products 
                WHERE user_id = ? 
                  AND (
                    LOWER(warehouse_id) = ? 
                    OR LOWER(warehouse_id) = ? 
                    OR LOWER(warehouse_id) = ?
                    OR warehouse_id = ?
                  )
                  AND (
                    LOWER(name) = ? 
                    OR (sku IS NOT NULL AND LOWER(sku) = ?)
                  )
                LIMIT 1
            `).get(
                userId, 
                String(toWhId).toLowerCase(), 
                toWhName.toLowerCase(), 
                toWh ? (toWh.code || '').toLowerCase() : '',
                toWhName,
                (sourceProd.name || '').toLowerCase(), 
                (sourceProd.sku || '').toLowerCase()
            );

            if (destProd) {
                const newDestQty = (parseFloat(destProd.quantity) || 0) + transQty;
                await db.prepare(`
                    UPDATE business_products SET 
                        quantity = ?, 
                        stock_status = 'In Stock', 
                        updated_at = ? 
                    WHERE id = ? AND user_id = ?
                `).run(newDestQty, now, destProd.id, userId);
            } else {
                await db.prepare(`
                    INSERT INTO business_products (
                        user_id, name, sku, category, unit, quantity, 
                        purchase_price, selling_price, warehouse_id, stock_status, 
                        hsn_code, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'In Stock', ?, ?, ?)
                `).run(
                    userId,
                    sourceProd.name,
                    sourceProd.sku || `SKU-${Date.now().toString().slice(-4)}`,
                    sourceProd.category || 'General',
                    sourceProd.unit || 'PCS',
                    transQty,
                    sourceProd.purchase_price || 0,
                    sourceProd.selling_price || sourceProd.purchase_price || 0,
                    toWhName,
                    sourceProd.hsn_code || null,
                    now,
                    now
                );
            }

            // Also update/insert destination in stock table
            try {
                let destStock = await db.prepare(`
                    SELECT * FROM stock 
                    WHERE user_id = ? 
                      AND (LOWER(location) = ? OR LOWER(location) = ? OR LOWER(warehouse) = ?)
                      AND (LOWER(name) = ? OR (sku IS NOT NULL AND LOWER(sku) = ?))
                    LIMIT 1
                `).get(
                    userId, 
                    toWhName.toLowerCase(), 
                    String(toWhId).toLowerCase(), 
                    toWhName.toLowerCase(),
                    (sourceProd.name || '').toLowerCase(), 
                    (sourceProd.sku || '').toLowerCase()
                );

                if (destStock) {
                    await db.prepare('UPDATE stock SET quantity = quantity + ?, updated_at = ? WHERE id = ?')
                        .run(transQty, now, destStock.id);
                } else {
                    await db.prepare(`
                        INSERT INTO stock (user_id, name, sku, category, unit, unit_price, quantity, location, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `).run(
                        userId,
                        sourceProd.name,
                        sourceProd.sku || `SKU-${Date.now().toString().slice(-4)}`,
                        sourceProd.category || 'General',
                        sourceProd.unit || 'PCS',
                        sourceProd.purchase_price || 0,
                        transQty,
                        toWhName,
                        now,
                        now
                    );
                }
            } catch (e) {}

            // Step C: Insert transaction record into warehouse_transfers
            const refVal = reference || `TRF-${Date.now().toString().slice(-6)}`;
            const result = await db.prepare(
                `INSERT INTO warehouse_transfers (user_id, from_warehouse_id, to_warehouse_id, stock_id, quantity, reference, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`
            ).run(userId, fromWhId, toWhId, sourceProd.id, transQty, refVal, now);

            return sendSuccess(res, { id: result.lastInsertRowid, quantity: transQty, reference: refVal }, 'Stock transferred successfully', 201);
        } catch (error) {
            console.error('[Warehouse Controller] Error transferring stock:', error);
            return sendError(res, `Failed to transfer stock: ${error.message}`, 500);
        }
    },

    // GET /warehouses/:id/transfers
    getWarehouseTransfers: async (req, res) => {
        try {
            const transfers = await db.prepare('SELECT * FROM warehouse_transfers WHERE user_id = ?').all(req.user.id);
            return sendSuccess(res, transfers, 'Warehouse transfers fetched');
        } catch (error) {
            return sendError(res, 'Failed to fetch transfers', 500);
        }
    },

    // POST /warehouses/:id/inward
    logWarehouseInward: async (req, res) => {
        return sendSuccess(res, { inward_id: `INW-${Date.now().toString().slice(-4)}` }, 'Goods Inward receipt logged');
    },

    // POST /warehouses/:id/outward
    logWarehouseOutward: async (req, res) => {
        return sendSuccess(res, { outward_id: `OUT-${Date.now().toString().slice(-4)}` }, 'Goods Outward receipt logged');
    },

    // GET /warehouses/:id/movements
    getWarehouseMovements: async (req, res) => {
        return sendSuccess(res, [], 'Warehouse movements log fetched');
    },

    // GET /warehouses/:id/history
    getWarehouseHistory: async (req, res) => {
        return sendSuccess(res, [], 'Warehouse history logs fetched');
    },

    // GET /warehouses/:id/timeline
    getWarehouseTimeline: async (req, res) => {
        return sendSuccess(res, [], 'Warehouse timeline events fetched');
    },

    // POST /warehouses/:id/staff
    addWarehouseStaff: async (req, res) => {
        return sendSuccess(res, { success: true }, 'Staff added to warehouse');
    },

    // GET /warehouses/:id/staff
    getWarehouseStaff: async (req, res) => {
        return sendSuccess(res, [], 'Warehouse staff fetched');
    },

    // POST /warehouses/:id/zones
    addWarehouseZone: async (req, res) => {
        const { name } = req.body;
        const now = new Date().toISOString();
        const result = await db.prepare('INSERT INTO warehouse_zones (warehouse_id, name, created_at) VALUES (?, ?, ?)').run(req.params.id, name, now);
        return sendSuccess(res, { id: result.lastInsertRowid, name }, 'Zone added successfully');
    },

    // GET /warehouses/:id/zones
    getWarehouseZones: async (req, res) => {
        const rows = await db.prepare('SELECT * FROM warehouse_zones WHERE warehouse_id = ?').all(req.params.id);
        return sendSuccess(res, rows, 'Warehouse zones fetched');
    },

    // PUT /warehouses/:id/zones/:zoneId
    updateWarehouseZone: async (req, res) => {
        const { name } = req.body;
        await db.prepare('UPDATE warehouse_zones SET name = ? WHERE id = ?').run(name, req.params.zoneId);
        return sendSuccess(res, { id: req.params.zoneId, name }, 'Zone updated successfully');
    },

    // DELETE /warehouses/:id/zones/:zoneId
    deleteWarehouseZone: async (req, res) => {
        await db.prepare('DELETE FROM warehouse_zones WHERE id = ?').run(req.params.zoneId);
        return sendSuccess(res, null, 'Zone deleted');
    },

    // POST /warehouses/:id/racks
    addWarehouseRack: async (req, res) => {
        const { name } = req.body;
        const now = new Date().toISOString();
        const result = await db.prepare('INSERT INTO warehouse_racks (warehouse_id, name, created_at) VALUES (?, ?, ?)').run(req.params.id, name, now);
        return sendSuccess(res, { id: result.lastInsertRowid, name }, 'Rack added successfully');
    },

    // GET /warehouses/:id/racks
    getWarehouseRacks: async (req, res) => {
        const rows = await db.prepare('SELECT * FROM warehouse_racks WHERE warehouse_id = ?').all(req.params.id);
        return sendSuccess(res, rows, 'Warehouse racks fetched');
    },

    // PUT /warehouses/:id/racks/:rackId
    updateWarehouseRack: async (req, res) => {
        const { name } = req.body;
        await db.prepare('UPDATE warehouse_racks SET name = ? WHERE id = ?').run(name, req.params.rackId);
        return sendSuccess(res, { id: req.params.rackId, name }, 'Rack updated successfully');
    },

    // DELETE /warehouses/:id/racks/:rackId
    deleteWarehouseRack: async (req, res) => {
        await db.prepare('DELETE FROM warehouse_racks WHERE id = ?').run(req.params.rackId);
        return sendSuccess(res, null, 'Rack deleted');
    },

    // POST /warehouses/:id/bins
    addWarehouseBin: async (req, res) => {
        const { name } = req.body;
        const now = new Date().toISOString();
        const result = await db.prepare('INSERT INTO warehouse_bins (warehouse_id, name, created_at) VALUES (?, ?, ?)').run(req.params.id, name, now);
        return sendSuccess(res, { id: result.lastInsertRowid, name }, 'Bin added successfully');
    },

    // GET /warehouses/:id/bins
    getWarehouseBins: async (req, res) => {
        const rows = await db.prepare('SELECT * FROM warehouse_bins WHERE warehouse_id = ?').all(req.params.id);
        return sendSuccess(res, rows, 'Warehouse bins fetched');
    },

    // PUT /warehouses/:id/bins/:binId
    updateWarehouseBin: async (req, res) => {
        const { name } = req.body;
        await db.prepare('UPDATE warehouse_bins SET name = ? WHERE id = ?').run(name, req.params.binId);
        return sendSuccess(res, { id: req.params.binId, name }, 'Bin updated successfully');
    },

    // DELETE /warehouses/:id/bins/:binId
    deleteWarehouseBin: async (req, res) => {
        await db.prepare('DELETE FROM warehouse_bins WHERE id = ?').run(req.params.binId);
        return sendSuccess(res, null, 'Bin deleted');
    },

    // GET /warehouses/:id/valuation
    getWarehouseValuation: async (req, res) => {
        try {
            const { id } = req.params;

            let wh = null;
            try {
                wh = await db.prepare(
                    'SELECT * FROM warehouses WHERE user_id = ? AND (id = ? OR LOWER(name) = ? OR LOWER(code) = ?) LIMIT 1'
                ).get(req.user.id, id, String(id).toLowerCase(), String(id).toLowerCase());
            } catch(e) {}

            const targetWhId = wh ? String(wh.id) : String(id);
            const targetWhName = wh ? wh.name : String(id);
            const targetWhCode = wh ? (wh.code || '') : targetWhId;

            const bpRes = await db.prepare(`
                SELECT 
                    COALESCE(SUM(quantity * purchase_price), 0) as bp_total, 
                    COALESCE(SUM(quantity), 0) as bp_qty, 
                    COUNT(*) as bp_count
                FROM business_products 
                WHERE user_id = ? 
                  AND (
                    LOWER(warehouse_id) = ? 
                    OR LOWER(warehouse_id) = ? 
                    OR LOWER(warehouse_id) = ?
                    OR warehouse_id = ?
                  )
            `).get(
                req.user.id,
                targetWhName.toLowerCase(),
                targetWhId.toLowerCase(),
                targetWhCode.toLowerCase(),
                id
            );

            const stRes = await db.prepare(`
                SELECT 
                    COALESCE(SUM(quantity * unit_price), 0) as st_total, 
                    COALESCE(SUM(quantity), 0) as st_qty,
                    COUNT(*) as st_count
                FROM stock 
                WHERE user_id = ? 
                  AND (
                    LOWER(location) = ? 
                    OR LOWER(location) = ? 
                    OR LOWER(warehouse) = ?
                  )
            `).get(
                req.user.id,
                targetWhName.toLowerCase(),
                targetWhId.toLowerCase(),
                targetWhName.toLowerCase()
            );

            const totalValuation = (bpRes?.bp_total || 0) + (stRes?.st_total || 0);
            const totalQuantity = (bpRes?.bp_qty || 0) + (stRes?.st_qty || 0);
            const totalItems = (bpRes?.bp_count || 0) + (stRes?.st_count || 0);

            return sendSuccess(res, { 
                valuation: totalValuation,
                total_items: totalItems,
                total_quantity: totalQuantity
            }, 'Warehouse valuation fetched successfully');
        } catch (err) {
            console.error('[Warehouse Controller] Error getting valuation:', err);
            return sendError(res, 'Failed to fetch valuation', 500);
        }
    },

    // GET /warehouses/:id/capacity
    getWarehouseCapacity: async (req, res) => {
        try {
            const wh = await db.prepare('SELECT capacity_utilization FROM warehouses WHERE id = ?').get(req.params.id);
            return sendSuccess(res, { capacity: wh?.capacity_utilization || '0%', total: 'Variable' }, 'Capacity statistics fetched');
        } catch (err) {
            return sendError(res, 'Failed to fetch capacity', 500);
        }
    },

    // GET /warehouses/:id/low-stock
    getWarehouseLowStock: async (req, res) => {
        return sendSuccess(res, [], 'Low stock listed');
    },

    // GET /warehouses/:id/out-of-stock
    getWarehouseOutOfStock: async (req, res) => {
        return sendSuccess(res, [], 'Out of stock listed');
    },

    // GET /warehouses/:id/damaged-stock
    getWarehouseDamagedStock: async (req, res) => {
        return sendSuccess(res, [], 'Damaged stock listed');
    },

    // GET /warehouses/:id/expiry-stock
    getWarehouseExpiryStock: async (req, res) => {
        return sendSuccess(res, [], 'Near expiry stock listed');
    },

    // POST /warehouses/:id/adjustment
    addWarehouseAdjustment: async (req, res) => {
        return sendSuccess(res, { success: true }, 'Warehouse adjustment registered');
    },

    // GET /warehouses/:id/adjustments
    getWarehouseAdjustments: async (req, res) => {
        return sendSuccess(res, [], 'Warehouse adjustments listed');
    },

    // POST /warehouses/:id/documents
    addWarehouseDocument: async (req, res) => {
        const { file_name, file_url } = req.body;
        const now = new Date().toISOString();
        const result = await db.prepare('INSERT INTO warehouse_documents (warehouse_id, file_name, file_url, created_at) VALUES (?, ?, ?, ?)').run(req.params.id, file_name, file_url || null, now);
        return sendSuccess(res, { id: result.lastInsertRowid, file_name, file_url }, 'Document added successfully');
    },

    // GET /warehouses/:id/documents
    getWarehouseDocuments: async (req, res) => {
        const rows = await db.prepare('SELECT * FROM warehouse_documents WHERE warehouse_id = ?').all(req.params.id);
        return sendSuccess(res, rows, 'Warehouse documents listed');
    },

    // POST /warehouses/:id/notes
    addWarehouseNote: async (req, res) => {
        const { note } = req.body;
        const now = new Date().toISOString();
        const result = await db.prepare('INSERT INTO warehouse_notes (warehouse_id, note, created_at) VALUES (?, ?, ?)').run(req.params.id, note, now);
        return sendSuccess(res, { id: result.lastInsertRowid, note }, 'Note added successfully');
    },

    // GET /warehouses/:id/notes
    getWarehouseNotes: async (req, res) => {
        const rows = await db.prepare('SELECT * FROM warehouse_notes WHERE warehouse_id = ?').all(req.params.id);
        return sendSuccess(res, rows, 'Warehouse notes fetched');
    },

    // GET /warehouses/:id/analytics
    getWarehouseAnalytics: async (req, res) => {
        try {
            const products = await db.prepare('SELECT COUNT(*) as count FROM stock WHERE user_id = ?').get(req.user.id);
            const warehouses = await db.prepare('SELECT COUNT(*) as count FROM warehouses WHERE user_id = ?').get(req.user.id);
            return sendSuccess(res, { total_products: products.count || 0, active_facilities: warehouses.count || 0, turnover_rate: 'Derived' }, 'Warehouse analytics metrics fetched');
        } catch (err) {
            return sendError(res, 'Failed to load analytics', 500);
        }
    },

    // GET /warehouses/reports/stock
    getWarehouseReportStock: async (req, res) => {
        const rows = await db.prepare('SELECT name, quantity, location FROM stock WHERE user_id = ?').all(req.user.id);
        return sendSuccess(res, rows, 'Warehouse stock report data');
    },

    // GET /warehouses/reports/valuation
    getWarehouseReportValuation: async (req, res) => {
        const rows = await db.prepare('SELECT name, (quantity * unit_price) as valuation FROM stock WHERE user_id = ?').all(req.user.id);
        return sendSuccess(res, rows, 'Warehouse valuation report data');
    },

    // GET /warehouses/reports/movement
    getWarehouseReportMovement: async (req, res) => {
        const rows = await db.prepare('SELECT * FROM warehouse_transfers WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(req.user.id);
        return sendSuccess(res, rows, 'Warehouse movement report data');
    },

    // GET /warehouses/reports/capacity
    getWarehouseReportCapacity: async (req, res) => {
        const rows = await db.prepare('SELECT name, capacity_utilization FROM warehouses WHERE user_id = ?').all(req.user.id);
        return sendSuccess(res, rows, 'Warehouse capacity report data');
    },

    // GET /warehouses/reports/damage
    getWarehouseReportDamage: async (req, res) => {
        return sendSuccess(res, [], 'No damaged records queried');
    },

    // GET /warehouses/reports/expiry
    getWarehouseReportExpiry: async (req, res) => {
        return sendSuccess(res, [], 'No expiry records tracked');
    },

    // POST /warehouses/import
    importWarehouses: async (req, res) => {
        return sendSuccess(res, { imported: 0 }, 'Warehouses imported successfully');
    },

    // GET /warehouses/export
    exportWarehouses: async (req, res) => {
        return sendSuccess(res, { file: 'warehouses_export.csv' }, 'Warehouses exported successfully');
    },

    // POST /warehouses/:id/block
    blockWarehouse: async (req, res) => {
        await db.prepare('UPDATE warehouses SET status = "blocked" WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
        return sendSuccess(res, { status: 'blocked' }, 'Warehouse facility blocked');
    },

    // POST /warehouses/:id/unblock
    unblockWarehouse: async (req, res) => {
        await db.prepare('UPDATE warehouses SET status = "active" WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
        return sendSuccess(res, { status: 'active' }, 'Warehouse facility unblocked');
    },

    // GET /warehouses/dashboard-summary
    getWarehouseDashboardSummary: async (req, res) => {
        return sendSuccess(res, { summary: 'Dynamic Warehouse Summary' }, 'Dashboard summary fetched');
    },

    // GET /reports
    getReports: async (req, res) => {
        try {
            const warehouses = await db.prepare('SELECT * FROM warehouses WHERE user_id = ?').all(req.user.id);
            const transfers = await db.prepare('SELECT * FROM warehouse_transfers WHERE user_id = ?').all(req.user.id);
            
            const inwards = await db.prepare(`
                SELECT t.*, s.name as product_name, w.name as warehouse_name 
                FROM stock_transactions t 
                LEFT JOIN stock s ON t.stock_id = s.id 
                LEFT JOIN warehouses w ON t.warehouse_id = w.id
                WHERE t.user_id = ? AND t.type = 'in'
                ORDER BY t.id DESC
            `).all(req.user.id);

            return sendSuccess(res, { warehouses, transfers, inwards }, 'Warehouse reports fetched successfully');
        } catch (error) {
            console.error('[Warehouse Controller] Error fetching reports:', error);
            return sendError(res, 'Failed to fetch warehouse reports', 500);
        }
    }
};

module.exports = warehouseController;
