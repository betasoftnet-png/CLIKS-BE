const fs = require('fs');
const path = './controllers/warehouseController.js';
let content = fs.readFileSync(path, 'utf8');

const receiveFunc = `
    // PUT /warehouses/transfers/:transferId/receive
    receiveTransfer: async (req, res) => {
        try {
            const transferId = req.params.transferId;
            const userId = req.user.id;
            const now = new Date().toISOString();

            const transfer = await db.prepare('SELECT * FROM warehouse_transfers WHERE id = ? AND user_id = ?').get(transferId, userId);
            if (!transfer) return sendError(res, 'Transfer not found', 404);
            if (transfer.status === 'Completed') return sendSuccess(res, transfer, 'Transfer already completed');

            // 1. Mark as completed
            await db.prepare('UPDATE warehouse_transfers SET status = "Completed" WHERE id = ?').run(transferId);

            const transQty = transfer.quantity;
            const toWhId = transfer.to_warehouse_id;
            const stock_id = transfer.stock_id;

            // 2. Resolve destination warehouse
            let toWh = null;
            try {
                toWh = await db.prepare('SELECT * FROM warehouses WHERE user_id = ? AND (id = ? OR LOWER(name) = ? OR LOWER(code) = ?) LIMIT 1')
                    .get(userId, toWhId, String(toWhId).toLowerCase(), String(toWhId).toLowerCase());
            } catch (e) {}
            const toWhName = toWh ? toWh.name : String(toWhId);

            // 3. Resolve source product for reference details
            let sourceProd = await db.prepare('SELECT * FROM business_products WHERE id = ? AND user_id = ?').get(stock_id, userId);
            if (!sourceProd) {
                sourceProd = { name: 'Stock Item', sku: \`SKU-\${Date.now()}\`, category: 'General', unit: 'PCS', purchase_price: 0, selling_price: 0 };
            }

            // 4. Add to destination in business_products
            let destProd = null;
            try {
                destProd = await db.prepare(\`
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
                \`).get(userId, String(toWhId).toLowerCase(), toWhName.toLowerCase(), toWh ? (toWh.code || '').toLowerCase() : '', toWhName, (sourceProd.name || '').toLowerCase(), (sourceProd.sku || '').toLowerCase());
            } catch(e) {}

            if (destProd) {
                await db.prepare(\`
                    UPDATE business_products SET quantity = quantity + ?, stock_status = 'In Stock', updated_at = ? WHERE id = ?
                \`).run(transQty, now, destProd.id);
            } else {
                await db.prepare(\`
                    INSERT INTO business_products (
                        user_id, name, sku, category, unit, quantity, purchase_price, selling_price, warehouse_id, stock_status, hsn_code, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'In Stock', ?, ?, ?)
                \`).run(userId, sourceProd.name, sourceProd.sku, sourceProd.category, sourceProd.unit, transQty, sourceProd.purchase_price, sourceProd.selling_price || sourceProd.purchase_price, toWhName, sourceProd.hsn_code || null, now, now);
            }

            // 5. Add to destination in stock table
            try {
                let destStock = await db.prepare(\`
                    SELECT * FROM stock 
                    WHERE user_id = ? 
                      AND (LOWER(location) = ? OR LOWER(location) = ? OR LOWER(warehouse) = ?)
                      AND (LOWER(name) = ? OR (sku IS NOT NULL AND LOWER(sku) = ?))
                    LIMIT 1
                \`).get(userId, toWhName.toLowerCase(), String(toWhId).toLowerCase(), toWhName.toLowerCase(), (sourceProd.name || '').toLowerCase(), (sourceProd.sku || '').toLowerCase());

                if (destStock) {
                    await db.prepare('UPDATE stock SET quantity = quantity + ?, updated_at = ? WHERE id = ?').run(transQty, now, destStock.id);
                } else {
                    await db.prepare(\`
                        INSERT INTO stock (user_id, name, sku, category, unit, unit_price, quantity, location, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    \`).run(userId, sourceProd.name, sourceProd.sku, sourceProd.category, sourceProd.unit, sourceProd.purchase_price, transQty, toWhName, now, now);
                }
            } catch(e) {}

            return sendSuccess(res, { id: transferId, status: 'Completed' }, 'Transfer marked as received and stock updated');
        } catch(error) {
            console.error('[Warehouse Controller] Error receiving transfer:', error);
            return sendError(res, 'Failed to receive transfer', 500);
        }
    },
`;

content = content.replace(
    '// GET /warehouses/:id/transfers',
    receiveFunc + '\n    // GET /warehouses/:id/transfers'
);

fs.writeFileSync(path, content);
console.log('Added receiveTransfer implementation');
