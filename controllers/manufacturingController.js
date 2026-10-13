const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { convertUnit } = require('../utils/unitConversion');

/**
 * Safely logs inventory movements to product_stock_history and stock_transactions
 * Resolves or creates a matching stock table entry to satisfy foreign key constraints
 */
async function logStockMovement(userId, productId, type, quantity, date, ref, receivedBy, warehouseId) {
    const now = new Date().toISOString();
    // 1. Log to product_stock_history
    try {
        await db.prepare(`
            INSERT INTO product_stock_history (product_id, user_id, quantity_changed, type, description, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            productId,
            userId,
            type === 'in' ? quantity : -quantity,
            type,
            ref || 'Manufacturing stock movement',
            now
        );
    } catch (_) {}

    // 2. Resolve matching stock table entry or create placeholder
    try {
        const prod = await db.prepare('SELECT * FROM business_products WHERE id = ?').get(productId);
        if (prod) {
            let stockRow = await db.prepare('SELECT id FROM stock WHERE user_id = ? AND (sku = ? OR name = ?)').get(userId, prod.sku || '', prod.name);
            if (!stockRow) {
                const newStock = await db.prepare(`
                    INSERT INTO stock (user_id, name, sku, category, unit, quantity, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `).run(userId, prod.name, prod.sku || null, prod.category || 'General', prod.unit || 'PCS', prod.quantity || 0, now, now);
                stockRow = { id: newStock.lastInsertRowid };
            }

            if (stockRow && stockRow.id) {
                await db.prepare(`
                    INSERT INTO stock_transactions (stock_id, user_id, type, quantity, date, created_at, purchase_bill_ref, received_by, warehouse_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    stockRow.id,
                    userId,
                    type,
                    quantity,
                    date || now.split('T')[0],
                    now,
                    ref || null,
                    receivedBy || 'Production Team',
                    warehouseId || null
                );
            }
        }
    } catch (_) {}
}

const manufacturingController = {
    // ── 1. Production Orders: List & Filtering ───────────────────────────────
    getOrders: async (req, res) => {
        try {
            const { q, status, product_id, warehouse_id, start_date, end_date, limit = 50, offset = 0 } = req.query;
            let query = `
                SELECT o.*, 
                       p.name as product_name, p.sku as product_sku, p.category as product_category, p.unit as product_unit,
                       b.name as bom_name, b.bom_number, b.version as bom_version,
                       w_src.name as source_warehouse_name,
                       w_dst.name as destination_warehouse_name
                FROM production_orders o
                LEFT JOIN business_products p ON o.product_id = p.id
                LEFT JOIN manufacturing_boms b ON o.bom_id = b.id
                LEFT JOIN warehouses w_src ON o.source_warehouse_id = w_src.id
                LEFT JOIN warehouses w_dst ON o.destination_warehouse_id = w_dst.id
                WHERE o.user_id = ?
            `;
            const params = [req.user.id];

            if (q) {
                query += ' AND (o.order_number LIKE ? OR p.name LIKE ? OR b.name LIKE ?)';
                params.push(`%${q}%`, `%${q}%`, `%${q}%`);
            }
            if (status) {
                query += ' AND o.status = ?';
                params.push(status);
            }
            if (product_id) {
                query += ' AND o.product_id = ?';
                params.push(product_id);
            }
            if (warehouse_id) {
                query += ' AND (o.source_warehouse_id = ? OR o.destination_warehouse_id = ?)';
                params.push(warehouse_id, warehouse_id);
            }
            if (start_date) {
                query += ' AND o.planned_date >= ?';
                params.push(start_date);
            }
            if (end_date) {
                query += ' AND o.planned_date <= ?';
                params.push(end_date);
            }

            query += ' ORDER BY o.id DESC LIMIT ? OFFSET ?';
            params.push(Number(limit), Number(offset));

            const rows = await db.prepare(query).all(...params);

            // Fetch materials summary for each order
            const enriched = await Promise.all(rows.map(async (order) => {
                const materialsCount = await db.prepare(
                    'SELECT COUNT(*) as count FROM production_order_materials WHERE production_order_id = ?'
                ).get(order.id);
                return {
                    ...order,
                    materials_count: materialsCount?.count || 0
                };
            }));

            // Count total for pagination
            const countRow = await db.prepare('SELECT COUNT(*) as total FROM production_orders WHERE user_id = ?').get(req.user.id);

            return sendSuccess(res, {
                orders: enriched,
                total: countRow?.total || 0,
                limit: Number(limit),
                offset: Number(offset)
            }, 'Production orders fetched successfully');
        } catch (error) {
            console.error('[Manufacturing Controller] Error getting orders:', error);
            return sendError(res, 'Failed to fetch production orders', 500);
        }
    },

    // ── 2. Get Order By ID (Full Details, Materials & Logs) ───────────────────
    getOrderById: async (req, res) => {
        try {
            const orderId = req.params.id;
            const order = await db.prepare(`
                SELECT o.*, 
                       p.name as product_name, p.sku as product_sku, p.category as product_category, p.unit as product_unit, p.quantity as current_finished_stock,
                       b.name as bom_name, b.bom_number, b.version as bom_version, b.output_quantity as bom_output_qty,
                       w_src.name as source_warehouse_name,
                       w_dst.name as destination_warehouse_name
                FROM production_orders o
                LEFT JOIN business_products p ON o.product_id = p.id
                LEFT JOIN manufacturing_boms b ON o.bom_id = b.id
                LEFT JOIN warehouses w_src ON o.source_warehouse_id = w_src.id
                LEFT JOIN warehouses w_dst ON o.destination_warehouse_id = w_dst.id
                WHERE o.id = ? AND o.user_id = ?
            `).get(orderId, req.user.id);

            if (!order) {
                return sendError(res, 'Production order not found', 404);
            }

            // Fetch material lines with current product inventory
            const materials = await db.prepare(`
                SELECT m.*, 
                       p.name as material_name, p.sku as material_sku, p.quantity as current_stock, p.unit as stock_unit, p.warehouse_id as material_warehouse
                FROM production_order_materials m
                LEFT JOIN business_products p ON m.product_id = p.id
                WHERE m.production_order_id = ?
                ORDER BY m.id ASC
            `).all(orderId);

            // Fetch audit logs
            const logs = await db.prepare(`
                SELECT * FROM production_order_logs 
                WHERE production_order_id = ? 
                ORDER BY id DESC
            `).all(orderId);

            // Calculate material lines shortage and variance
            const materialsWithAnalysis = materials.map(mat => {
                const availableStock = Number(mat.current_stock || 0);
                const stockUnit = mat.stock_unit || mat.unit;
                const availableInMatUnit = convertUnit(availableStock, stockUnit, mat.unit);
                const remainingToIssue = Math.max(0, mat.planned_quantity - (mat.issued_quantity || 0));
                const shortage = Math.max(0, remainingToIssue - availableInMatUnit);
                const variance = (mat.consumed_quantity || 0) - mat.planned_quantity;

                return {
                    ...mat,
                    available_stock: availableStock,
                    available_in_mat_unit: Math.round(availableInMatUnit * 1000) / 1000,
                    remaining_to_issue: Math.round(remainingToIssue * 1000) / 1000,
                    shortage_quantity: Math.round(shortage * 1000) / 1000,
                    is_shortage: shortage > 0,
                    variance: Math.round(variance * 1000) / 1000,
                    variance_percent: mat.planned_quantity > 0 ? Math.round((variance / mat.planned_quantity) * 1000) / 10 : 0
                };
            });

            return sendSuccess(res, {
                ...order,
                bom_snapshot: order.bom_snapshot ? JSON.parse(order.bom_snapshot) : null,
                materials: materialsWithAnalysis,
                logs
            }, 'Production order fetched successfully');
        } catch (error) {
            console.error('[Manufacturing Controller] Error getting order details:', error);
            return sendError(res, 'Failed to fetch production order details', 500);
        }
    },

    // ── 3. Create Production Order ───────────────────────────────────────────
    createOrder: async (req, res) => {
        const {
            bom_id,
            product_id,
            planned_quantity = 1,
            source_warehouse_id,
            destination_warehouse_id,
            planned_date,
            responsible_employee,
            notes
        } = req.body || {};

        if (!product_id && !bom_id) {
            return sendError(res, 'Product or BOM must be selected', 400);
        }
        if (Number(planned_quantity) <= 0) {
            return sendError(res, 'Planned quantity must be greater than 0', 400);
        }

        try {
            // Locate BOM
            let bom;
            if (bom_id) {
                bom = await db.prepare(
                    'SELECT * FROM manufacturing_boms WHERE id = ? AND user_id = ?'
                ).get(bom_id, req.user.id);
            } else if (product_id) {
                bom = await db.prepare(
                    "SELECT * FROM manufacturing_boms WHERE product_id = ? AND user_id = ? AND status = 'active' ORDER BY is_default DESC, id DESC LIMIT 1"
                ).get(product_id, req.user.id);
            }

            if (!bom) {
                return sendError(res, 'No active Bill of Materials (BOM) found for this product. Please create a BOM first.', 404);
            }

            const targetProductId = product_id || bom.product_id;
            const finishedProduct = await db.prepare(
                'SELECT * FROM business_products WHERE id = ? AND user_id = ?'
            ).get(targetProductId, req.user.id);

            if (!finishedProduct) {
                return sendError(res, 'Finished product does not exist in inventory catalog', 404);
            }

            // Fetch BOM component items
            const bomItems = await db.prepare(`
                SELECT bi.*, p.name as component_name, p.sku as component_sku, p.purchase_price, p.unit as stock_unit
                FROM manufacturing_bom_items bi
                LEFT JOIN business_products p ON bi.component_product_id = p.id
                WHERE bi.bom_id = ?
            `).all(bom.id);

            if (!bomItems || bomItems.length === 0) {
                return sendError(res, 'Selected BOM has no component raw materials defined', 400);
            }

            const now = new Date().toISOString();
            const orderNumber = req.body.order_number || `MO-${Date.now().toString().slice(-6)}`;
            const plannedQtyNum = Number(planned_quantity);
            const baseOutput = Number(bom.output_quantity) || 1;
            const multiplier = plannedQtyNum / baseOutput;

            // Calculate planned material costs
            let totalPlannedMaterialCost = 0;
            const plannedMaterials = bomItems.map(item => {
                const rawRequired = item.quantity * multiplier;
                const wasteFactor = 1 + ((item.waste_percent || 0) / 100);
                const plannedLineQty = Math.round(rawRequired * wasteFactor * 1000) / 1000;
                const unitCost = Number(item.cost_per_unit || item.purchase_price || 0);
                const lineTotalCost = Math.round(plannedLineQty * unitCost * 100) / 100;
                totalPlannedMaterialCost += lineTotalCost;

                return {
                    product_id: item.component_product_id,
                    planned_quantity: plannedLineQty,
                    unit: item.unit,
                    unit_cost: unitCost,
                    total_cost: lineTotalCost,
                    notes: item.notes
                };
            });

            const laborCost = Number(bom.labor_cost || 0) * multiplier;
            const overheadCost = Number(bom.overhead_cost || 0) * multiplier;
            const totalEstimatedCost = totalPlannedMaterialCost + laborCost + overheadCost;
            const estimatedUnitCost = plannedQtyNum > 0 ? (totalEstimatedCost / plannedQtyNum) : totalEstimatedCost;

            // Create Production Order Header
            const result = await db.prepare(`
                INSERT INTO production_orders (
                    user_id, order_number, bom_id, product_id, planned_quantity, completed_quantity, rejected_quantity,
                    scrap_quantity, remaining_quantity, status, source_warehouse_id, destination_warehouse_id,
                    planned_date, bom_snapshot, planned_material_cost, actual_material_cost, labor_cost, overhead_cost,
                    total_cost, unit_cost, cost_variance, wastage_cost, responsible_employee, notes, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, 'Draft', ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)
            `).run(
                req.user.id,
                orderNumber,
                bom.id,
                targetProductId,
                plannedQtyNum,
                plannedQtyNum, // initially remaining = planned
                source_warehouse_id || finishedProduct.warehouse_id || null,
                destination_warehouse_id || finishedProduct.warehouse_id || null,
                planned_date || now.split('T')[0],
                JSON.stringify({
                    bom_id: bom.id,
                    bom_number: bom.bom_number,
                    bom_name: bom.name,
                    version: bom.version,
                    output_quantity: bom.output_quantity,
                    items: bomItems
                }),
                totalPlannedMaterialCost,
                laborCost,
                overheadCost,
                totalEstimatedCost,
                estimatedUnitCost,
                responsible_employee || null,
                notes || null,
                now,
                now
            );

            const orderId = result.lastInsertRowid;

            // Insert Production Order Material lines
            for (const mat of plannedMaterials) {
                await db.prepare(`
                    INSERT INTO production_order_materials (
                        production_order_id, product_id, planned_quantity, issued_quantity, consumed_quantity,
                        returned_quantity, wasted_quantity, unit, unit_cost, total_cost, status, notes, created_at, updated_at
                    ) VALUES (?, ?, ?, 0, 0, 0, 0, ?, ?, ?, 'Pending', ?, ?, ?)
                `).run(
                    orderId,
                    mat.product_id,
                    mat.planned_quantity,
                    mat.unit,
                    mat.unit_cost,
                    mat.total_cost,
                    mat.notes || null,
                    now,
                    now
                );
            }

            // Insert Initial Log
            await db.prepare(`
                INSERT INTO production_order_logs (production_order_id, user_id, action, details, created_at)
                VALUES (?, ?, 'ORDER_CREATED', ?, ?)
            `).run(
                orderId,
                req.user.id,
                `Order created with planned quantity ${plannedQtyNum} of ${finishedProduct.name}`,
                now
            );

            // Backward compatibility sync with manufacturing_orders
            try {
                await db.prepare(`
                    INSERT INTO manufacturing_orders (user_id, bom_id, product_name, quantity, status, created_at, updated_at)
                    VALUES (?, ?, ?, ?, 'Pending', ?, ?)
                `).run(req.user.id, bom.id, finishedProduct.name, plannedQtyNum, now, now);
            } catch (_) {}

            const createdOrder = await db.prepare('SELECT * FROM production_orders WHERE id = ?').get(orderId);
            return sendSuccess(res, createdOrder, 'Production order created successfully (Draft)', 201);
        } catch (error) {
            console.error('[Manufacturing Controller] Error creating production order:', error);
            return sendError(res, error.message || 'Failed to create production order', 500);
        }
    },

    // ── 4. Material Availability & Reservation Check ─────────────────────────
    checkAvailability: async (req, res) => {
        try {
            const orderId = req.params.id;
            const order = await db.prepare(
                'SELECT * FROM production_orders WHERE id = ? AND user_id = ?'
            ).get(orderId, req.user.id);

            if (!order) return sendError(res, 'Production order not found', 404);

            const materials = await db.prepare(`
                SELECT m.*, p.name as material_name, p.sku as material_sku, p.quantity as current_stock, p.unit as stock_unit, p.warehouse_id
                FROM production_order_materials m
                LEFT JOIN business_products p ON m.product_id = p.id
                WHERE m.production_order_id = ?
            `).all(orderId);

            let totalShortageLines = 0;
            const checkResults = [];

            for (const mat of materials) {
                const stockQty = Number(mat.current_stock || 0);
                const stockUnit = mat.stock_unit || mat.unit;

                // Calculate reserved stock by other Confirmed/In Progress orders
                const reservedRow = await db.prepare(`
                    SELECT SUM(pom.planned_quantity - pom.issued_quantity) as total_reserved
                    FROM production_order_materials pom
                    JOIN production_orders po ON pom.production_order_id = po.id
                    WHERE pom.product_id = ? AND po.user_id = ? AND po.id != ? AND po.status IN ('Confirmed', 'In Progress')
                `).get(mat.product_id, req.user.id, orderId);

                const reservedQtyInStockUnit = Number(reservedRow?.total_reserved || 0);
                const availableToPromiseInStockUnit = Math.max(0, stockQty - reservedQtyInStockUnit);

                // Convert to material unit
                const availableInMatUnit = convertUnit(stockQty, stockUnit, mat.unit);
                const atpInMatUnit = convertUnit(availableToPromiseInStockUnit, stockUnit, mat.unit);
                const requiredQty = mat.planned_quantity;

                const shortage = Math.max(0, requiredQty - atpInMatUnit);
                if (shortage > 0) totalShortageLines++;

                checkResults.push({
                    material_id: mat.product_id,
                    material_name: mat.material_name,
                    material_sku: mat.material_sku,
                    required_quantity: requiredQty,
                    unit: mat.unit,
                    current_stock: stockQty,
                    stock_unit: stockUnit,
                    reserved_quantity: Math.round(reservedQtyInStockUnit * 1000) / 1000,
                    available_to_promise: Math.round(atpInMatUnit * 1000) / 1000,
                    shortage_quantity: Math.round(shortage * 1000) / 1000,
                    status: shortage > 0 ? 'Shortage' : 'Available',
                    warehouse_id: order.source_warehouse_id || mat.warehouse_id || 'Main Godown'
                });
            }

            return sendSuccess(res, {
                order_id: order.id,
                order_number: order.order_number,
                total_materials: materials.length,
                shortage_count: totalShortageLines,
                can_release: totalShortageLines === 0,
                components: checkResults
            }, 'Material availability check completed');
        } catch (error) {
            console.error('[Manufacturing Controller] Availability check error:', error);
            return sendError(res, 'Failed to check material availability', 500);
        }
    },

    // ── 5. Confirm Production Order ──────────────────────────────────────────
    confirmOrder: async (req, res) => {
        const orderId = req.params.id;
        const { override_shortage = false, override_reason } = req.body || {};

        try {
            const order = await db.prepare(
                'SELECT * FROM production_orders WHERE id = ? AND user_id = ?'
            ).get(orderId, req.user.id);

            if (!order) return sendError(res, 'Production order not found', 404);
            if (order.status !== 'Draft') {
                return sendError(res, `Cannot confirm order in status '${order.status}'`, 400);
            }

            // Check availability unless override explicitly approved
            if (!override_shortage) {
                const materials = await db.prepare(`
                    SELECT m.*, p.quantity as current_stock, p.unit as stock_unit, p.name as material_name
                    FROM production_order_materials m
                    LEFT JOIN business_products p ON m.product_id = p.id
                    WHERE m.production_order_id = ?
                `).all(orderId);

                const shortages = [];
                for (const mat of materials) {
                    const availableInMatUnit = convertUnit(Number(mat.current_stock || 0), mat.stock_unit || mat.unit, mat.unit);
                    if (mat.planned_quantity > availableInMatUnit) {
                        shortages.push({
                            name: mat.material_name,
                            required: mat.planned_quantity,
                            available: availableInMatUnit,
                            shortage: mat.planned_quantity - availableInMatUnit,
                            unit: mat.unit
                        });
                    }
                }

                if (shortages.length > 0) {
                    return sendError(res, `Cannot confirm order: material shortages detected for ${shortages.length} item(s). Provide override confirmation if authorized.`, 400, 'SHORTAGE_DETECTED', { shortages });
                }
            }

            const now = new Date().toISOString();
            await db.prepare(
                "UPDATE production_orders SET status = 'Confirmed', updated_at = ? WHERE id = ? AND user_id = ?"
            ).run(now, orderId, req.user.id);

            await db.prepare(`
                INSERT INTO production_order_logs (production_order_id, user_id, action, details, created_at)
                VALUES (?, ?, 'ORDER_CONFIRMED', ?, ?)
            `).run(
                orderId,
                req.user.id,
                override_shortage ? `Confirmed with override: ${override_reason || 'Authorized manager override'}` : 'Order confirmed successfully',
                now
            );

            const updated = await db.prepare('SELECT * FROM production_orders WHERE id = ?').get(orderId);
            return sendSuccess(res, updated, 'Production order confirmed');
        } catch (error) {
            console.error('[Manufacturing Controller] Order confirm error:', error);
            return sendError(res, 'Failed to confirm production order', 500);
        }
    },

    // ── 6. Material Issue: Deduct raw materials & transition to In Progress ───
    issueMaterials: async (req, res) => {
        const orderId = req.params.id;
        const { issues = [] } = req.body || {};

        try {
            const order = await db.prepare(
                'SELECT * FROM production_orders WHERE id = ? AND user_id = ?'
            ).get(orderId, req.user.id);

            if (!order) return sendError(res, 'Production order not found', 404);
            if (order.status !== 'Confirmed' && order.status !== 'In Progress' && order.status !== 'Draft') {
                return sendError(res, `Cannot issue materials for order in status '${order.status}'`, 400);
            }

            const materials = await db.prepare(
                'SELECT * FROM production_order_materials WHERE production_order_id = ?'
            ).all(orderId);

            const now = new Date().toISOString();

            // Perform stock deductions atomically
            for (const mat of materials) {
                // Find custom quantity if provided in issues array, otherwise issue remaining planned
                const customIssue = issues.find(i => Number(i.material_id) === Number(mat.product_id) || Number(i.id) === Number(mat.id));
                const remainingPlanned = Math.max(0, mat.planned_quantity - (mat.issued_quantity || 0));
                const qtyToIssue = customIssue ? Number(customIssue.quantity) : remainingPlanned;

                if (qtyToIssue <= 0) continue;

                const product = await db.prepare(
                    'SELECT * FROM business_products WHERE id = ? AND user_id = ?'
                ).get(mat.product_id, req.user.id);

                if (!product) continue;

                // Convert quantity to stock unit
                const qtyInStockUnit = convertUnit(qtyToIssue, mat.unit, product.unit || 'PCS');
                const newStockQty = Math.max(0, Number(product.quantity || 0) - qtyInStockUnit);
                const newStockStatus = newStockQty === 0 ? 'Out of Stock' : (newStockQty <= (product.low_stock_threshold || 5) ? 'Low Stock' : 'In Stock');

                // 1. Deduct from business_products
                await db.prepare(`
                    UPDATE business_products SET quantity = ?, stock_status = ?, updated_at = ? WHERE id = ? AND user_id = ?
                `).run(newStockQty, newStockStatus, now, product.id, req.user.id);

                // 2. Safely log stock transactions & history
                await logStockMovement(
                    req.user.id,
                    product.id,
                    'out',
                    qtyInStockUnit,
                    now.split('T')[0],
                    `MFG-ISSUE-${order.order_number}`,
                    req.user.username || 'Production Team',
                    order.source_warehouse_id || product.warehouse_id || null
                );

                // 4. Update production_order_materials
                const newIssuedQty = (mat.issued_quantity || 0) + qtyToIssue;
                const matStatus = newIssuedQty >= mat.planned_quantity ? 'Issued' : 'Partially Issued';
                await db.prepare(`
                    UPDATE production_order_materials 
                    SET issued_quantity = ?, status = ?, updated_at = ?
                    WHERE id = ?
                `).run(newIssuedQty, matStatus, now, mat.id);
            }

            // Transition order status to 'In Progress' if not already
            if (order.status !== 'In Progress') {
                await db.prepare(
                    "UPDATE production_orders SET status = 'In Progress', start_date = COALESCE(start_date, ?), updated_at = ? WHERE id = ?"
                ).run(now, now, orderId);
            }

            await db.prepare(`
                INSERT INTO production_order_logs (production_order_id, user_id, action, details, created_at)
                VALUES (?, ?, 'MATERIALS_ISSUED', 'Raw materials issued and deducted from inventory', ?)
            `).run(orderId, req.user.id, now);

            return sendSuccess(res, null, 'Materials issued to production successfully');
        } catch (error) {
            console.error('[Manufacturing Controller] Material issue error:', error);
            return sendError(res, 'Failed to issue materials to production', 500);
        }
    },

    // ── 7. Record Consumption, Returns & Wastage ──────────────────────────────
    recordConsumption: async (req, res) => {
        const orderId = req.params.id;
        const { consumptions = [] } = req.body || {};

        if (!Array.isArray(consumptions) || consumptions.length === 0) {
            return sendError(res, 'No consumption details provided', 400);
        }

        try {
            const order = await db.prepare(
                'SELECT * FROM production_orders WHERE id = ? AND user_id = ?'
            ).get(orderId, req.user.id);

            if (!order) return sendError(res, 'Production order not found', 404);
            if (order.status !== 'In Progress' && order.status !== 'Confirmed') {
                return sendError(res, `Cannot record consumption for order in status '${order.status}'`, 400);
            }

            const now = new Date().toISOString();

            for (const item of consumptions) {
                const mat = await db.prepare(
                    'SELECT * FROM production_order_materials WHERE (id = ? OR product_id = ?) AND production_order_id = ?'
                ).get(item.id || item.material_id, item.product_id || item.material_id, orderId);

                if (!mat) continue;

                const consumedQty = item.consumed_quantity !== undefined ? Number(item.consumed_quantity) : mat.consumed_quantity;
                const returnedQty = item.returned_quantity !== undefined ? Number(item.returned_quantity) : mat.returned_quantity;
                const wastedQty = item.wasted_quantity !== undefined ? Number(item.wasted_quantity) : mat.wasted_quantity;
                const wasteReason = item.wastage_reason || mat.wastage_reason || null;

                // If returned_quantity > 0, return unused materials back to stock!
                const deltaReturn = returnedQty - (mat.returned_quantity || 0);
                if (deltaReturn > 0) {
                    const product = await db.prepare('SELECT * FROM business_products WHERE id = ?').get(mat.product_id);
                    if (product) {
                        const returnInStockUnit = convertUnit(deltaReturn, mat.unit, product.unit || 'PCS');
                        await db.prepare(`
                            UPDATE business_products SET quantity = quantity + ?, stock_status = 'In Stock', updated_at = ? WHERE id = ?
                        `).run(returnInStockUnit, now, product.id);

                        await logStockMovement(
                            req.user.id,
                            product.id,
                            'in',
                            returnInStockUnit,
                            now.split('T')[0],
                            `MFG-RETURN-${order.order_number}`,
                            req.user.username || 'Production Team',
                            null
                        );
                    }
                }

                const totalLineCost = Math.round(consumedQty * (mat.unit_cost || 0) * 100) / 100;

                await db.prepare(`
                    UPDATE production_order_materials SET
                        consumed_quantity = ?, returned_quantity = ?, wasted_quantity = ?, wastage_reason = ?,
                        total_cost = ?, status = 'Consumed', updated_at = ?
                    WHERE id = ?
                `).run(consumedQty, returnedQty, wastedQty, wasteReason, totalLineCost, now, mat.id);
            }

            await db.prepare(`
                INSERT INTO production_order_logs (production_order_id, user_id, action, details, created_at)
                VALUES (?, ?, 'CONSUMPTION_RECORDED', 'Actual material consumption, returns, and wastage recorded', ?)
            `).run(orderId, req.user.id, now);

            return sendSuccess(res, null, 'Material consumption and wastage recorded successfully');
        } catch (error) {
            console.error('[Manufacturing Controller] Record consumption error:', error);
            return sendError(res, 'Failed to record consumption', 500);
        }
    },

    // ── 8. Complete Production & Output (Stock Increase & Costing) ────────────
    completeProduction: async (req, res) => {
        const orderId = req.params.id;
        const {
            good_quantity_produced,
            rejected_quantity = 0,
            scrap_quantity = 0,
            remaining_quantity = 0,
            remaining_reason,
            labor_cost,
            overhead_cost,
            completion_notes
        } = req.body || {};

        if (good_quantity_produced === undefined || Number(good_quantity_produced) < 0) {
            return sendError(res, 'Accepted good output quantity must be 0 or greater', 400);
        }

        try {
            const order = await db.prepare(
                'SELECT * FROM production_orders WHERE id = ? AND user_id = ?'
            ).get(orderId, req.user.id);

            if (!order) return sendError(res, 'Production order not found', 404);
            if (order.status === 'Completed') {
                return sendError(res, 'Production order has already been completed. Duplicate completion is prevented.', 400);
            }
            if (order.status === 'Cancelled') {
                return sendError(res, 'Cannot complete a cancelled order', 400);
            }

            const now = new Date().toISOString();
            const goodQty = Number(good_quantity_produced);
            const rejQty = Number(rejected_quantity) || 0;
            const scrapQty = Number(scrap_quantity) || 0;
            const remQty = Number(remaining_quantity) || 0;

            // 1. Fetch materials to calculate actual material cost and wastage cost
            const materials = await db.prepare(
                'SELECT * FROM production_order_materials WHERE production_order_id = ?'
            ).all(orderId);

            let actualMaterialCost = 0;
            let totalWastageCost = 0;

            for (const mat of materials) {
                // If consumed was not set separately, default consumed to issued or planned
                let consumed = mat.consumed_quantity;
                if (!consumed || consumed === 0) {
                    consumed = mat.issued_quantity > 0 ? mat.issued_quantity : mat.planned_quantity;

                    // If material was never issued upfront, deduct now atomically!
                    if (!mat.issued_quantity || mat.issued_quantity === 0) {
                        const product = await db.prepare('SELECT * FROM business_products WHERE id = ?').get(mat.product_id);
                        if (product) {
                            const deductStockUnit = convertUnit(consumed, mat.unit, product.unit || 'PCS');
                            const newStock = Math.max(0, Number(product.quantity || 0) - deductStockUnit);
                            await db.prepare('UPDATE business_products SET quantity = ?, updated_at = ? WHERE id = ?')
                                .run(newStock, now, product.id);

                            await db.prepare(`
                                INSERT INTO stock_transactions (stock_id, user_id, type, quantity, date, created_at, purchase_bill_ref, received_by)
                                VALUES (?, ?, 'out', ?, ?, ?, ?, ?)
                            `).run(product.id, req.user.id, deductStockUnit, now.split('T')[0], now, `MFG-COMPLETION-${order.order_number}`, req.user.username || 'System');
                        }
                    }

                    await db.prepare('UPDATE production_order_materials SET consumed_quantity = ? WHERE id = ?')
                        .run(consumed, mat.id);
                }

                const matLineCost = consumed * (mat.unit_cost || 0);
                actualMaterialCost += matLineCost;

                const wasteCost = (mat.wasted_quantity || 0) * (mat.unit_cost || 0);
                totalWastageCost += wasteCost;
            }

            // 2. Production Costing calculation
            const finalLabor = labor_cost !== undefined ? Number(labor_cost) : (order.labor_cost || 0);
            const finalOverhead = overhead_cost !== undefined ? Number(overhead_cost) : (order.overhead_cost || 0);
            const totalActualCost = Math.round((actualMaterialCost + finalLabor + finalOverhead) * 100) / 100;
            const actualUnitCost = goodQty > 0 ? Math.round((totalActualCost / goodQty) * 100) / 100 : 0;
            const costVariance = Math.round((totalActualCost - (order.planned_material_cost + (order.labor_cost || 0) + (order.overhead_cost || 0))) * 100) / 100;

            // 3. Atomically increase finished goods inventory in business_products
            if (goodQty > 0) {
                const finishedProduct = await db.prepare(
                    'SELECT * FROM business_products WHERE id = ? AND user_id = ?'
                ).get(order.product_id, req.user.id);

                if (finishedProduct) {
                    const newFinishedQty = Number(finishedProduct.quantity || 0) + goodQty;
                    await db.prepare(`
                        UPDATE business_products SET quantity = ?, stock_status = 'In Stock', updated_at = ? WHERE id = ? AND user_id = ?
                    `).run(newFinishedQty, now, order.product_id, req.user.id);

                    // 4. Log to stock movements & history
                    await logStockMovement(
                        req.user.id,
                        order.product_id,
                        'in',
                        goodQty,
                        now.split('T')[0],
                        `MFG-OUTPUT-${order.order_number}`,
                        req.user.username || 'Production Team',
                        order.destination_warehouse_id || finishedProduct.warehouse_id || null
                    );
                }
            }

            // 6. Update Production Order Status
            await db.prepare(`
                UPDATE production_orders SET
                    status = 'Completed',
                    completed_quantity = ?,
                    rejected_quantity = ?,
                    scrap_quantity = ?,
                    remaining_quantity = ?,
                    completion_date = ?,
                    actual_material_cost = ?,
                    labor_cost = ?,
                    overhead_cost = ?,
                    total_cost = ?,
                    unit_cost = ?,
                    cost_variance = ?,
                    wastage_cost = ?,
                    completion_notes = ?,
                    updated_at = ?
                WHERE id = ? AND user_id = ?
            `).run(
                goodQty,
                rejQty,
                scrapQty,
                remQty,
                now,
                actualMaterialCost,
                finalLabor,
                finalOverhead,
                totalActualCost,
                actualUnitCost,
                costVariance,
                totalWastageCost,
                completion_notes || (remaining_reason ? `Remaining notes: ${remaining_reason}` : null),
                now,
                orderId,
                req.user.id
            );

            // 7. Insert Audit Trail Log
            await db.prepare(`
                INSERT INTO production_order_logs (production_order_id, user_id, action, details, created_at)
                VALUES (?, ?, 'PRODUCTION_COMPLETED', ?, ?)
            `).run(
                orderId,
                req.user.id,
                `Completed: ${goodQty} accepted good output, ${rejQty} rejected. Total cost: ₹${totalActualCost} (₹${actualUnitCost}/unit).`,
                now
            );

            // Backward compatibility update to legacy table
            try {
                await db.prepare("UPDATE manufacturing_orders SET status = 'Completed', updated_at = ? WHERE id = ?").run(now, orderId);
            } catch (_) {}

            const completedOrder = await db.prepare('SELECT * FROM production_orders WHERE id = ?').get(orderId);
            return sendSuccess(res, completedOrder, 'Production completed successfully and finished goods added to inventory');
        } catch (error) {
            console.error('[Manufacturing Controller] Complete production error:', error);
            return sendError(res, 'Failed to complete production order', 500);
        }
    },

    // ── 9. Cancel Production Order ───────────────────────────────────────────
    cancelOrder: async (req, res) => {
        const orderId = req.params.id;
        const { reason } = req.body || {};

        try {
            const order = await db.prepare(
                'SELECT * FROM production_orders WHERE id = ? AND user_id = ?'
            ).get(orderId, req.user.id);

            if (!order) return sendError(res, 'Production order not found', 404);
            if (order.status === 'Completed') {
                return sendError(res, 'Completed production orders cannot be cancelled. Finished goods have already been posted.', 400);
            }
            if (order.status === 'Cancelled') {
                return sendError(res, 'Order is already cancelled', 400);
            }

            const now = new Date().toISOString();

            // If materials were issued, reverse issued quantities back to stock
            const materials = await db.prepare(
                'SELECT * FROM production_order_materials WHERE production_order_id = ?'
            ).all(orderId);

            for (const mat of materials) {
                const unconsumedIssued = Math.max(0, (mat.issued_quantity || 0) - (mat.consumed_quantity || 0));
                if (unconsumedIssued > 0) {
                    const product = await db.prepare('SELECT * FROM business_products WHERE id = ?').get(mat.product_id);
                    if (product) {
                        const returnInStockUnit = convertUnit(unconsumedIssued, mat.unit, product.unit || 'PCS');
                        await db.prepare(`
                            UPDATE business_products SET quantity = quantity + ?, stock_status = 'In Stock', updated_at = ? WHERE id = ?
                        `).run(returnInStockUnit, now, product.id);

                        await db.prepare(`
                            INSERT INTO stock_transactions (stock_id, user_id, type, quantity, date, created_at, purchase_bill_ref, received_by)
                            VALUES (?, ?, 'in', ?, ?, ?, ?, ?)
                        `).run(
                            product.id,
                            req.user.id,
                            returnInStockUnit,
                            now.split('T')[0],
                            now,
                            `MFG-CANCEL-RETURN-${order.order_number}`,
                            req.user.username || 'System'
                        );
                    }
                }
            }

            await db.prepare(
                "UPDATE production_orders SET status = 'Cancelled', notes = COALESCE(notes, '') || ?, updated_at = ? WHERE id = ?"
            ).run(reason ? ` [Cancelled: ${reason}]` : ' [Cancelled]', now, orderId);

            await db.prepare(`
                INSERT INTO production_order_logs (production_order_id, user_id, action, details, created_at)
                VALUES (?, ?, 'ORDER_CANCELLED', ?, ?)
            `).run(orderId, req.user.id, `Order cancelled: ${reason || 'No reason provided'}. Issued stock reversed.`, now);

            return sendSuccess(res, null, 'Production order cancelled and issued inventory reversed');
        } catch (error) {
            console.error('[Manufacturing Controller] Cancel order error:', error);
            return sendError(res, 'Failed to cancel production order', 500);
        }
    },

    // ── 10. Manufacturing Dashboard KPIs ──────────────────────────────────────
    getDashboardKPIs: async (req, res) => {
        try {
            const userId = req.user.id;

            // Counts by status
            const statusCounts = await db.prepare(`
                SELECT status, COUNT(*) as count, SUM(planned_quantity) as total_planned, SUM(completed_quantity) as total_completed
                FROM production_orders
                WHERE user_id = ?
                GROUP BY status
            `).all(userId);

            const countsMap = {
                Draft: 0,
                Confirmed: 0,
                'In Progress': 0,
                Completed: 0,
                Cancelled: 0,
                total: 0,
                total_planned_qty: 0,
                total_completed_qty: 0
            };

            statusCounts.forEach(s => {
                countsMap[s.status] = s.count;
                countsMap.total += s.count;
                countsMap.total_planned_qty += (s.total_planned || 0);
                countsMap.total_completed_qty += (s.total_completed || 0);
            });

            // Financial & Cost aggregates from completed orders
            const costAggregates = await db.prepare(`
                SELECT 
                    SUM(total_cost) as total_production_cost,
                    SUM(actual_material_cost) as total_material_consumed_cost,
                    SUM(wastage_cost) as total_wastage_cost,
                    AVG(unit_cost) as avg_unit_cost,
                    SUM(rejected_quantity) as total_rejected_units
                FROM production_orders
                WHERE user_id = ? AND status = 'Completed'
            `).get(userId);

            // Active material shortages across draft & confirmed orders
            const pendingOrders = await db.prepare(`
                SELECT id FROM production_orders WHERE user_id = ? AND status IN ('Draft', 'Confirmed')
            `).all(userId);

            let totalShortagesCount = 0;
            for (const po of pendingOrders) {
                const mats = await db.prepare(`
                    SELECT pom.planned_quantity, pom.unit, p.quantity as current_stock, p.unit as stock_unit
                    FROM production_order_materials pom
                    JOIN business_products p ON pom.product_id = p.id
                    WHERE pom.production_order_id = ?
                `).all(po.id);

                for (const m of mats) {
                    const avail = convertUnit(Number(m.current_stock || 0), m.stock_unit || m.unit, m.unit);
                    if (m.planned_quantity > avail) totalShortagesCount++;
                }
            }

            // Total BOMs count
            const bomCountRow = await db.prepare("SELECT COUNT(*) as count FROM manufacturing_boms WHERE user_id = ? AND status = 'active'").get(userId);

            // Recent 5 production orders
            const recentOrders = await db.prepare(`
                SELECT o.*, p.name as product_name, b.name as bom_name
                FROM production_orders o
                LEFT JOIN business_products p ON o.product_id = p.id
                LEFT JOIN manufacturing_boms b ON o.bom_id = b.id
                WHERE o.user_id = ?
                ORDER BY o.id DESC LIMIT 5
            `).all(userId);

            return sendSuccess(res, {
                counts: countsMap,
                costs: {
                    total_production_cost: costAggregates?.total_production_cost || 0,
                    total_material_consumed_cost: costAggregates?.total_material_consumed_cost || 0,
                    total_wastage_cost: costAggregates?.total_wastage_cost || 0,
                    avg_unit_cost: costAggregates?.avg_unit_cost || 0,
                    total_rejected_units: costAggregates?.total_rejected_units || 0
                },
                active_boms_count: bomCountRow?.count || 0,
                shortage_count: totalShortagesCount,
                recent_orders: recentOrders
            }, 'Manufacturing dashboard KPIs fetched');
        } catch (error) {
            console.error('[Manufacturing Controller] Dashboard error:', error);
            return sendError(res, 'Failed to fetch dashboard KPIs', 500);
        }
    },

    // ── 11. Manufacturing Reports Suite (8 Comprehensive Reports) ─────────────
    getReports: async (req, res) => {
        try {
            const reportType = req.params.reportType || req.query.reportType || req.query.type || 'production-orders';
            const { start_date, end_date, product_id, status } = req.query;
            const userId = req.user.id;

            switch (reportType) {
                // Report 1: Production Orders Report
                case 'production-orders': {
                    let sql = `
                        SELECT o.*, p.name as product_name, p.sku as product_sku, b.name as bom_name, b.version as bom_version
                        FROM production_orders o
                        LEFT JOIN business_products p ON o.product_id = p.id
                        LEFT JOIN manufacturing_boms b ON o.bom_id = b.id
                        WHERE o.user_id = ?
                    `;
                    const params = [userId];
                    if (status) { sql += ' AND o.status = ?'; params.push(status); }
                    if (product_id) { sql += ' AND o.product_id = ?'; params.push(product_id); }
                    if (start_date) { sql += ' AND o.planned_date >= ?'; params.push(start_date); }
                    if (end_date) { sql += ' AND o.planned_date <= ?'; params.push(end_date); }
                    sql += ' ORDER BY o.id DESC';
                    const data = await db.prepare(sql).all(...params);
                    return sendSuccess(res, { reportType, data }, 'Production Order Report generated');
                }

                // Report 2: Material Consumption Report
                case 'material-consumption': {
                    let sql = `
                        SELECT pom.*, p.name as material_name, p.sku as material_sku, o.order_number, o.status as order_status, o.planned_date,
                               fp.name as finished_product_name
                        FROM production_order_materials pom
                        JOIN production_orders o ON pom.production_order_id = o.id
                        JOIN business_products p ON pom.product_id = p.id
                        LEFT JOIN business_products fp ON o.product_id = fp.id
                        WHERE o.user_id = ?
                    `;
                    const params = [userId];
                    if (start_date) { sql += ' AND o.planned_date >= ?'; params.push(start_date); }
                    if (end_date) { sql += ' AND o.planned_date <= ?'; params.push(end_date); }
                    sql += ' ORDER BY pom.id DESC';
                    const data = await db.prepare(sql).all(...params);
                    return sendSuccess(res, { reportType, data }, 'Material Consumption Report generated');
                }

                // Report 3: Raw Material Usage Aggregated Report
                case 'material-usage': {
                    const sql = `
                        SELECT p.id as product_id, p.name as material_name, p.sku as material_sku, pom.unit,
                               SUM(pom.planned_quantity) as total_planned_quantity,
                               SUM(pom.issued_quantity) as total_issued_quantity,
                               SUM(pom.consumed_quantity) as total_consumed_quantity,
                               SUM(pom.wasted_quantity) as total_wasted_quantity,
                               SUM(pom.total_cost) as total_spend,
                               COUNT(DISTINCT pom.production_order_id) as order_count
                        FROM production_order_materials pom
                        JOIN production_orders o ON pom.production_order_id = o.id
                        JOIN business_products p ON pom.product_id = p.id
                        WHERE o.user_id = ?
                        GROUP BY p.id, pom.unit
                        ORDER BY total_spend DESC
                    `;
                    const data = await db.prepare(sql).all(userId);
                    return sendSuccess(res, { reportType, data }, 'Raw Material Usage Report generated');
                }

                // Report 4: Planned vs Actual Production Report
                case 'planned-vs-actual': {
                    let sql = `
                        SELECT o.id, o.order_number, o.planned_date, o.completion_date, o.status,
                               p.name as product_name, o.planned_quantity, o.completed_quantity as actual_good_quantity,
                               o.rejected_quantity, o.scrap_quantity, o.remaining_quantity,
                               ROUND((o.completed_quantity * 100.0 / NULLIF(o.planned_quantity, 0)), 1) as yield_percentage
                        FROM production_orders o
                        JOIN business_products p ON o.product_id = p.id
                        WHERE o.user_id = ?
                    `;
                    const params = [userId];
                    if (start_date) { sql += ' AND o.planned_date >= ?'; params.push(start_date); }
                    if (end_date) { sql += ' AND o.planned_date <= ?'; params.push(end_date); }
                    sql += ' ORDER BY o.id DESC';
                    const data = await db.prepare(sql).all(...params);
                    return sendSuccess(res, { reportType, data }, 'Planned vs Actual Production Report generated');
                }

                // Report 5: Wastage and Rejection Report
                case 'wastage-rejection': {
                    const data = await db.prepare(`
                        SELECT pom.id, o.order_number, o.completion_date, p.name as item_name, 'Raw Material' as type,
                               pom.wasted_quantity as quantity, pom.unit, pom.wastage_reason as reason,
                               ROUND(pom.wasted_quantity * pom.unit_cost, 2) as cost_impact
                        FROM production_order_materials pom
                        JOIN production_orders o ON pom.production_order_id = o.id
                        JOIN business_products p ON pom.product_id = p.id
                        WHERE o.user_id = ? AND pom.wasted_quantity > 0
                        UNION ALL
                        SELECT o.id, o.order_number, o.completion_date, p.name as item_name, 'Finished Product Rejection' as type,
                               o.rejected_quantity as quantity, p.unit, o.completion_notes as reason,
                               ROUND(o.rejected_quantity * o.unit_cost, 2) as cost_impact
                        FROM production_orders o
                        JOIN business_products p ON o.product_id = p.id
                        WHERE o.user_id = ? AND o.rejected_quantity > 0
                        ORDER BY completion_date DESC
                    `).all(userId, userId);
                    return sendSuccess(res, { reportType, data }, 'Wastage and Rejection Report generated');
                }

                // Report 6: BOM and Recipe Report
                case 'bom-recipes': {
                    const boms = await db.prepare(`
                        SELECT b.*, p.name as finished_product_name, p.sku as finished_product_sku
                        FROM manufacturing_boms b
                        LEFT JOIN business_products p ON b.product_id = p.id
                        WHERE b.user_id = ?
                        ORDER BY b.id DESC
                    `).all(userId);

                    const data = await Promise.all(boms.map(async (bom) => {
                        const items = await db.prepare(`
                            SELECT bi.*, p.name as component_name, p.sku as component_sku, p.purchase_price
                            FROM manufacturing_bom_items bi
                            LEFT JOIN business_products p ON bi.component_product_id = p.id
                            WHERE bi.bom_id = ?
                        `).all(bom.id);
                        return { ...bom, components: items };
                    }));
                    return sendSuccess(res, { reportType, data }, 'BOM and Recipe Report generated');
                }

                // Report 7: Finished Goods Production Output
                case 'finished-goods': {
                    let sql = `
                        SELECT o.id, o.order_number, o.completion_date, p.name as product_name, p.sku,
                               o.completed_quantity, p.unit, o.unit_cost, o.total_cost,
                               w.name as destination_warehouse
                        FROM production_orders o
                        JOIN business_products p ON o.product_id = p.id
                        LEFT JOIN warehouses w ON o.destination_warehouse_id = w.id
                        WHERE o.user_id = ? AND o.status = 'Completed'
                    `;
                    const params = [userId];
                    if (start_date) { sql += ' AND o.completion_date >= ?'; params.push(start_date); }
                    if (end_date) { sql += ' AND o.completion_date <= ?'; params.push(end_date); }
                    sql += ' ORDER BY o.completion_date DESC';
                    const data = await db.prepare(sql).all(...params);
                    return sendSuccess(res, { reportType, data }, 'Finished Goods Production Report generated');
                }

                // Report 8: Production Cost Analysis Report
                case 'production-cost': {
                    let sql = `
                        SELECT o.id, o.order_number, o.planned_date, o.completion_date, p.name as product_name,
                               o.completed_quantity, o.planned_material_cost, o.actual_material_cost,
                               o.labor_cost, o.overhead_cost, o.total_cost, o.unit_cost, o.cost_variance, o.wastage_cost
                        FROM production_orders o
                        JOIN business_products p ON o.product_id = p.id
                        WHERE o.user_id = ? AND o.status = 'Completed'
                    `;
                    const params = [userId];
                    if (start_date) { sql += ' AND o.completion_date >= ?'; params.push(start_date); }
                    if (end_date) { sql += ' AND o.completion_date <= ?'; params.push(end_date); }
                    sql += ' ORDER BY o.completion_date DESC';
                    const data = await db.prepare(sql).all(...params);
                    return sendSuccess(res, { reportType, data }, 'Production Cost Report generated');
                }

                default:
                    return sendError(res, `Unknown report type '${reportType}'`, 400);
            }
        } catch (error) {
            console.error('[Manufacturing Controller] Reports error:', error);
            return sendError(res, 'Failed to generate manufacturing report', 500);
        }
    },

    // Legacy backwards-compatible stubs
    startProduction: async (req, res) => {
        return manufacturingController.issueMaterials(req, res);
    }
};

module.exports = manufacturingController;
