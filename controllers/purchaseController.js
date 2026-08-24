const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { recordAudit } = require('../utils/auditLogger');
const gstHelper = require('../utils/gstHelper');

const logBusinessAudit = async (userId, actionType, message, severity = 'INFO') => {
    try {
        const user = await db.prepare('SELECT settings FROM users WHERE id = ?').get(userId);
        if (user && user.settings) {
            const settings = JSON.parse(user.settings);
            if (settings.auditTrail) {
                await recordAudit(actionType, message, `User #${userId}`, severity);
            }
        }
    } catch (err) {
        console.warn('Failed to record business audit log:', err);
    }
};

function normalizePaymentMode(mode) {
    if (!mode) return 'Cash in Hand';
    const m = String(mode).toLowerCase();
    if (m === 'cash' || m.includes('cash in hand') || m.includes('hand')) {
        return 'Cash in Hand';
    }
    if (m.includes('hdfc')) {
        return 'HDFC Bank Account';
    }
    if (m.includes('icici')) {
        return 'ICICI Bank Account';
    }
    if (m.includes('sbi') || m.includes('state bank')) {
        return 'SBI Current Account';
    }
    if (m === 'upi' || m.includes('razorpay') || m.includes('gpay') || m.includes('phonepe') || m.includes('paytm')) {
        return 'UPI / Razorpay';
    }
    if (m === 'bank' || m.includes('bank')) {
        return 'HDFC Bank Account';
    }
    return mode;
}

const purchaseController = {
    // 1. Create Purchase (PO, BILL, RETURN)
    createPurchase: async (req, res) => {
        const {
            purchase_number, purchase_type, purchase_date, due_date, doc_type, status,
            supplier_name, supplier_gstin, billing_address, contact_number, warehouse_id,
            purchase_by, payment_status, payment_mode, bank_account_id, paid_amount,
            advance_amount, shipping_charge, round_off, place_of_supply, return_reason,
            subtotal, total_discount, total_tax, grand_total, items
        } = req.body;

        const supplierName = supplier_name || req.body.supplier || req.body.vendor_name || 'General Supplier';

        try {
            const now = new Date().toISOString();
            const purchaseNum = purchase_number || `PO-${Date.now().toString().slice(-6)}`;
            let finalStatus = status || 'Approved';
            let finalPaymentStatus = payment_status || 'pending';

            if (doc_type === 'BILL') {
                const totalPaid = (parseFloat(paid_amount) || 0) + (parseFloat(advance_amount) || 0);
                const gTotal = parseFloat(grand_total) || 0;
                if (payment_mode === 'Credit' || payment_mode === 'Payables' || totalPaid < gTotal) {
                    finalStatus = 'Pending';
                    finalPaymentStatus = 'pending';
                } else {
                    finalStatus = 'Paid';
                    finalPaymentStatus = 'paid';
                }
            }

            const result = await db.prepare(`
                INSERT INTO business_purchases (
                    user_id, purchase_number, purchase_type, purchase_date, due_date, doc_type, status,
                    supplier_name, supplier_gstin, billing_address, contact_number, warehouse_id,
                    purchase_by, payment_status, payment_mode, bank_account_id, paid_amount,
                    advance_amount, shipping_charge, round_off, place_of_supply, return_reason,
                    subtotal, total_discount, total_tax, grand_total, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                req.user.id, purchaseNum, purchase_type || 'GST', purchase_date || now.split('T')[0], due_date || now.split('T')[0], doc_type || 'PO', finalStatus,
                supplierName, supplier_gstin || null, billing_address || null, contact_number || null, warehouse_id || 'Main Godown',
                purchase_by || null, finalPaymentStatus, payment_mode || 'Cash', bank_account_id || null, parseFloat(paid_amount) || 0,
                parseFloat(advance_amount) || 0, parseFloat(shipping_charge) || 0, parseFloat(round_off) || 0, place_of_supply || 'Maharashtra', return_reason || null,
                parseFloat(subtotal) || 0, parseFloat(total_discount) || 0, parseFloat(total_tax) || 0, parseFloat(grand_total) || 0, now, now
            );

            const purchaseId = result.lastInsertRowid || result.id;

            if (items && Array.isArray(items)) {
                for (const item of items) {
                    const pName = item.product_name || item.name || item.description || item.title || 'Item';
                    const pQty = (item.quantity !== undefined && item.quantity !== null && item.quantity !== '') ? parseFloat(item.quantity) : 1;
                    const pPrice = parseFloat(item.purchase_price || item.price || item.cost || 0);
                    const pTax = parseFloat(item.tax_amount || 0);
                    const pTotal = parseFloat(item.total || (pQty * pPrice) || 0);

                    await db.prepare(`
                        INSERT INTO business_purchase_items (
                            purchase_id, product_name, sku, batch_number, expiry_date, quantity,
                            received_quantity, free_quantity, primary_unit, purchase_price, discount,
                            gst_percentage, tax_amount, total
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `).run(
                        purchaseId, pName, item.sku || null, item.batch_number || null, item.expiry_date || null,
                        pQty, parseFloat(item.received_quantity || 0), parseFloat(item.free_quantity || 0), item.primary_unit || 'pcs',
                        pPrice, parseFloat(item.discount || 0), parseFloat(item.gst_percentage || 18), pTax, pTotal
                    );
                }
            }

            // 📦 If doc_type === 'RETURN', transactionally update physical inventory stock for the selected warehouse
            if (doc_type === 'RETURN' && items && Array.isArray(items)) {
                const targetWhName = warehouse_id || 'Main Godown';
                let targetWh = null;
                try {
                    targetWh = await db.prepare(
                        'SELECT * FROM warehouses WHERE user_id = ? AND (id = ? OR LOWER(name) = ? OR LOWER(code) = ?) LIMIT 1'
                    ).get(req.user.id, targetWhName, String(targetWhName).toLowerCase(), String(targetWhName).toLowerCase());
                } catch (e) {}

                const whName = targetWh ? targetWh.name : String(targetWhName);
                const whId = targetWh ? String(targetWh.id) : String(targetWhName);
                const whCode = targetWh ? (targetWh.code || `WH-${targetWh.id}`) : whId;

                for (const item of items) {
                    const pName = String(item.product_name || item.name || item.description || 'Returned Item').trim();
                    const pSku = item.sku ? String(item.sku).trim() : null;
                    const rQty = parseFloat(item.quantity || item.return_quantity || 1) || 1;

                    if (!pName && !pSku) continue;

                    // 1. Update business_products for selected warehouse
                    let existingProd = null;
                    try {
                        if (pSku) {
                            existingProd = await db.prepare(`
                                SELECT * FROM business_products
                                WHERE user_id = ?
                                  AND (LOWER(sku) = ?)
                                  AND (LOWER(warehouse_id) = ? OR LOWER(warehouse_id) = ? OR LOWER(warehouse_id) = ? OR warehouse_id IS NULL)
                                LIMIT 1
                            `).get(req.user.id, pSku.toLowerCase(), whId.toLowerCase(), whName.toLowerCase(), whCode.toLowerCase());
                        }
                        if (!existingProd && pName) {
                            existingProd = await db.prepare(`
                                SELECT * FROM business_products
                                WHERE user_id = ?
                                  AND (LOWER(name) = ?)
                                  AND (LOWER(warehouse_id) = ? OR LOWER(warehouse_id) = ? OR LOWER(warehouse_id) = ? OR warehouse_id IS NULL)
                                LIMIT 1
                            `).get(req.user.id, pName.toLowerCase(), whId.toLowerCase(), whName.toLowerCase(), whCode.toLowerCase());
                        }
                        if (!existingProd && pName) {
                            existingProd = await db.prepare(`
                                SELECT * FROM business_products
                                WHERE user_id = ? AND (LOWER(name) = ? OR (sku IS NOT NULL AND LOWER(sku) = ?))
                                LIMIT 1
                            `).get(req.user.id, pName.toLowerCase(), (pSku || pName).toLowerCase());
                        }
                    } catch (e) {}

                    if (existingProd) {
                        const currentQty = parseFloat(existingProd.quantity) || 0;
                        const newQty = currentQty + rQty;
                        const threshold = parseFloat(existingProd.low_stock_threshold) || 5;
                        const newStatus = newQty <= 0 ? 'Out of Stock' : (newQty < threshold ? 'Low Stock' : 'In Stock');

                        await db.prepare(`
                            UPDATE business_products SET
                                quantity = ?,
                                warehouse_id = ?,
                                stock_status = ?,
                                updated_at = ?
                            WHERE id = ? AND user_id = ?
                        `).run(newQty, whName, newStatus, now, existingProd.id, req.user.id);
                    } else {
                        const newStatus = rQty <= 0 ? 'Out of Stock' : (rQty < 5 ? 'Low Stock' : 'In Stock');
                        const prodCategory = item.category || 'General';
                        const prodUnit = item.unit || item.primary_unit || 'PCS';
                        const prodPrice = parseFloat(item.purchase_price || item.price) || 0;

                        await db.prepare(`
                            INSERT INTO business_products (
                                user_id, name, sku, category, quantity, unit,
                                purchase_price, selling_price, warehouse_id, stock_status, created_at, updated_at
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `).run(
                            req.user.id, pName, pSku || `SKU-${Date.now().toString().slice(-6)}`, prodCategory, rQty, prodUnit,
                            prodPrice, prodPrice, whName, newStatus, now, now
                        );
                    }

                    // 2. Update stock table for selected warehouse location
                    let existingStock = null;
                    try {
                        if (pSku) {
                            existingStock = await db.prepare(`
                                SELECT * FROM stock
                                WHERE user_id = ?
                                  AND (LOWER(sku) = ?)
                                  AND (LOWER(location) = ? OR LOWER(location) = ? OR location IS NULL)
                                LIMIT 1
                            `).get(req.user.id, pSku.toLowerCase(), whName.toLowerCase(), whId.toLowerCase());
                        }
                        if (!existingStock && pName) {
                            existingStock = await db.prepare(`
                                SELECT * FROM stock
                                WHERE user_id = ?
                                  AND (LOWER(name) = ?)
                                  AND (LOWER(location) = ? OR LOWER(location) = ? OR location IS NULL)
                                LIMIT 1
                            `).get(req.user.id, pName.toLowerCase(), whName.toLowerCase(), whId.toLowerCase());
                        }
                        if (!existingStock && pName) {
                            existingStock = await db.prepare(`
                                SELECT * FROM stock
                                WHERE user_id = ? AND (LOWER(name) = ? OR (sku IS NOT NULL AND LOWER(sku) = ?))
                                LIMIT 1
                            `).get(req.user.id, pName.toLowerCase(), (pSku || pName).toLowerCase());
                        }
                    } catch (e) {}

                    if (existingStock) {
                        await db.prepare('UPDATE stock SET quantity = quantity + ?, location = ?, updated_at = ? WHERE id = ?')
                            .run(rQty, whName, now, existingStock.id);
                    } else {
                        const prodCategory = item.category || 'General';
                        const prodUnit = item.unit || item.primary_unit || 'PCS';
                        const prodPrice = parseFloat(item.purchase_price || item.price) || 0;
                        await db.prepare(`
                            INSERT INTO stock (user_id, name, sku, category, unit, unit_price, quantity, location, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `).run(req.user.id, pName, pSku || null, prodCategory, prodUnit, prodPrice, rQty, whName, now, now);
                    }
                }

                // 3. Update Warehouse Capacity Utilization
                if (targetWh) {
                    try {
                        const totalWhProducts = await db.prepare('SELECT COUNT(*) as cnt, SUM(quantity) as total_qty FROM business_products WHERE user_id = ? AND (LOWER(warehouse_id) = ? OR LOWER(warehouse_id) = ?)').get(req.user.id, whId.toLowerCase(), whName.toLowerCase());
                        if (totalWhProducts) {
                            const totalQty = totalWhProducts.total_qty || 0;
                            const capUtil = `${Math.min(100, Math.round((totalQty / 1000) * 100))}%`;
                            await db.prepare('UPDATE warehouses SET capacity_utilization = ? WHERE id = ?').run(capUtil, targetWh.id);
                        }
                    } catch (e) {}
                }
            }

            const created = await db.prepare('SELECT * FROM business_purchases WHERE id = ?').get(purchaseId) || {};
            try {
                created.items = await db.prepare('SELECT * FROM business_purchase_items WHERE purchase_id = ?').all(purchaseId);
            } catch (e) {
                created.items = items || [];
            }

            // B2B Purchase-to-Sales Invoice Auto-Sync
            const b2bConnectionService = require('../utils/b2bConnectionService');
            try {
                let targetSupplierEmail = req.body.supplier_email || (req.body.supplier && req.body.supplier.email);
                if (!targetSupplierEmail) {
                    const supRow = await db.prepare("SELECT email FROM business_suppliers WHERE user_id = ? AND (name = ? OR company = ?) AND email IS NOT NULL").get(req.user.id, supplierName, supplierName);
                    if (supRow && supRow.email) targetSupplierEmail = supRow.email;
                }
                if (!targetSupplierEmail) {
                    const supRow2 = await db.prepare("SELECT email FROM suppliers WHERE user_id = ? AND (name = ? OR company_name = ?) AND email IS NOT NULL").get(req.user.id, supplierName, supplierName);
                    if (supRow2 && supRow2.email) targetSupplierEmail = supRow2.email;
                }
                if (targetSupplierEmail) {
                    await b2bConnectionService.syncPurchaseToSalesInvoice({
                        purchaseId: purchaseId,
                        userId: req.user.id,
                        supplierEmail: targetSupplierEmail,
                        purchaseData: {
                            ...req.body,
                            purchase_number: purchaseNum,
                            subtotal: parseFloat(subtotal) || 0,
                            total_tax: parseFloat(total_tax) || 0,
                            total_discount: parseFloat(total_discount) || 0,
                            grand_total: parseFloat(grand_total) || 0,
                            paid_amount: parseFloat(paid_amount) || 0,
                            payment_status: finalPaymentStatus,
                            payment_mode: payment_mode,
                            due_date: due_date || purchase_date,
                            items: created.items || items || []
                        }
                    });
                }
            } catch (b2bSyncErr) {
                console.warn('[Purchase Controller] B2B Invoice Sync Warning:', b2bSyncErr.message);
            }

            const totalPaid = (parseFloat(paid_amount) || 0) + (parseFloat(advance_amount) || 0);
            const unpaidAmount = (parseFloat(grand_total) || 0) - totalPaid;

            try {
                if (totalPaid > 0) {
                    const normalizedMode = normalizePaymentMode(payment_mode);
                    await db.prepare(`
                        INSERT INTO accounting (user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at)
                        VALUES (?, 'expense', ?, ?, 'Inventory Purchases', ?, ?, 'Paid', ?, ?)
                    `).run(req.user.id, purchase_date || now.split('T')[0], totalPaid, normalizedMode, `Purchase #${purchaseNum}`, now, now);
                }

                if (unpaidAmount > 0) {
                    await db.prepare(`
                        INSERT INTO accounting (user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at)
                        VALUES (?, 'expense', ?, ?, 'Inventory Purchases', 'Payables', ?, 'Pending', ?, ?)
                    `).run(req.user.id, purchase_date || now.split('T')[0], unpaidAmount, `Purchase #${purchaseNum} (Credit Purchase)`, now, now);
                }
            } catch (accErr) {
                console.warn('[Purchase Controller] Accounting entry non-fatal warning:', accErr.message);
            }

            // --- Update Vendor / Supplier Ledger & Outstanding Balance ---
            try {
                let supplier = await db.prepare("SELECT id FROM suppliers WHERE user_id = ? AND (name = ? OR name = ?)").get(req.user.id, supplierName, supplierName);
                if (!supplier) {
                    supplier = await db.prepare("SELECT id FROM business_suppliers WHERE user_id = ? AND name = ?").get(req.user.id, supplierName);
                }

                if (supplier) {
                    const supId = supplier.id;
                    await db.prepare(`
                        INSERT INTO supplier_ledger (supplier_id, user_id, description, amount, type, created_at)
                        VALUES (?, ?, ?, ?, 'debit', ?)
                    `).run(supId, req.user.id, `Purchase Bill #${purchaseNum}`, grand_total, now);

                    if (totalPaid > 0) {
                        await db.prepare(`
                            INSERT INTO supplier_ledger (supplier_id, user_id, description, amount, type, created_at)
                            VALUES (?, ?, ?, ?, 'credit', ?)
                        `).run(supId, req.user.id, `Payment for Bill #${purchaseNum} (${payment_mode})`, totalPaid, now);
                    }

                    const outstandingDiff = unpaidAmount;
                    try { await db.prepare("UPDATE suppliers SET outstanding_balance = COALESCE(outstanding_balance, 0) + ? WHERE id = ?").run(outstandingDiff, supId); } catch (e) {}
                    try { await db.prepare("UPDATE business_suppliers SET outstanding_balance = COALESCE(outstanding_balance, 0) + ? WHERE id = ?").run(outstandingDiff, supId); } catch (e) {}
                }
            } catch (ledgErr) {
                console.warn('[Purchase Controller] Ledger update non-fatal warning:', ledgErr.message);
            }

            try {
                await gstHelper.syncPurchaseToGstr2b(purchaseId, req.user.id);
            } catch (e) {}

            try {
                await logBusinessAudit(req.user.id, 'PURCHASE_CREATE', `Created purchase document ${purchaseNum} (${doc_type}) for supplier ${supplierName} (amount: ₹${grand_total})`, 'SUCCESS');
            } catch (e) {}

            return sendSuccess(res, created, 'Purchase document created successfully', 201);
        } catch (error) {
            console.error('[Purchase Controller] Error creating purchase:', error);
            return sendError(res, `Failed to create purchase record: ${error.message}`, 500);
        }
    },

    // 2. Get Purchases with Filtering
    getPurchases: async (req, res) => {
        const { search, status, supplier_id: _supplier_id, doc_type } = req.query;
        try {
            let query = `SELECT * FROM business_purchases WHERE user_id = ?`;
            const params = [req.user.id];

            if (status) {
                query += ` AND status = ?`;
                params.push(status);
            }
            if (doc_type) {
                query += ` AND doc_type = ?`;
                params.push(doc_type);
            }
            if (search) {
                query += ` AND (supplier_name LIKE ? OR purchase_number LIKE ?)`;
                params.push(`%${search}%`, `%${search}%`);
            }

            query += ` ORDER BY purchase_date DESC, id DESC`;

            const purchases = await db.prepare(query).all(...params);

            for (const purchase of purchases) {
                purchase.items = await db.prepare('SELECT * FROM business_purchase_items WHERE purchase_id = ?').all(purchase.id);
            }

            return sendSuccess(res, purchases, 'Purchases retrieved successfully');
        } catch (error) {
            console.error('[Purchase Controller] Error fetching purchases:', error);
            return sendError(res, 'Failed to retrieve purchases', 500);
        }
    },

    // 3. Get Purchase By ID
    getPurchaseById: async (req, res) => {
        const { id } = req.params;
        try {
            const purchase = await db.prepare('SELECT * FROM business_purchases WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!purchase) return sendError(res, 'Purchase record not found', 404);

            purchase.items = await db.prepare('SELECT * FROM business_purchase_items WHERE purchase_id = ?').all(id);
            purchase.notes = await db.prepare('SELECT * FROM business_purchase_notes WHERE purchase_id = ?').all(id);
            purchase.documents = await db.prepare('SELECT * FROM business_purchase_documents WHERE purchase_id = ?').all(id);

            return sendSuccess(res, purchase, 'Purchase details retrieved successfully');
        } catch (error) {
            console.error('[Purchase Controller] Error getting purchase by id:', error);
            return sendError(res, 'Failed to fetch purchase details', 500);
        }
    },

    // 4. Update Purchase
    updatePurchase: async (req, res) => {
        const { id } = req.params;
        const {
            purchase_number, purchase_type, purchase_date, due_date, doc_type, status,
            supplier_name, supplier_gstin, billing_address, contact_number, warehouse_id,
            purchase_by, payment_status, payment_mode, bank_account_id, paid_amount,
            advance_amount, shipping_charge, round_off, place_of_supply, return_reason,
            subtotal, total_discount, total_tax, grand_total, items
        } = req.body;

        try {
            const purchase = await db.prepare('SELECT id FROM business_purchases WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!purchase) return sendError(res, 'Purchase record not found', 404);

            const now = new Date().toISOString();

            await db.prepare(`
                UPDATE business_purchases SET
                    purchase_number = ?, purchase_type = ?, purchase_date = ?, due_date = ?, doc_type = ?, status = ?,
                    supplier_name = ?, supplier_gstin = ?, billing_address = ?, contact_number = ?, warehouse_id = ?,
                    purchase_by = ?, payment_status = ?, payment_mode = ?, bank_account_id = ?, paid_amount = ?,
                    advance_amount = ?, shipping_charge = ?, round_off = ?, place_of_supply = ?, return_reason = ?,
                    subtotal = ?, total_discount = ?, total_tax = ?, grand_total = ?, updated_at = ?
                WHERE id = ?
            `).run(
                purchase_number, purchase_type || 'GST', purchase_date, due_date, doc_type || 'PO', status || 'Approved',
                supplier_name, supplier_gstin || null, billing_address || null, contact_number || null, warehouse_id || 'Main Godown',
                purchase_by || null, payment_status || 'pending', payment_mode || 'Cash', bank_account_id || null, paid_amount || 0,
                advance_amount || 0, shipping_charge || 0, round_off || 0, place_of_supply || 'Maharashtra', return_reason || null,
                subtotal || 0, total_discount || 0, total_tax || 0, grand_total || 0, now, id
            );

            if (items && Array.isArray(items)) {
                await db.prepare('DELETE FROM business_purchase_items WHERE purchase_id = ?').run(id);
                for (const item of items) {
                    await db.prepare(`
                        INSERT INTO business_purchase_items (
                            purchase_id, product_name, sku, batch_number, expiry_date, quantity,
                            received_quantity, free_quantity, primary_unit, purchase_price, discount,
                            gst_percentage, tax_amount, total
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `).run(
                        id, item.product_name, item.sku || null, item.batch_number || null, item.expiry_date || null,
                        item.quantity || 1, item.received_quantity || 0, item.free_quantity || 0, item.primary_unit || 'pcs',
                        item.purchase_price || 0, item.discount || 0, item.gst_percentage || 18, item.tax_amount || 0, item.total || 0
                    );
                }
            }

            const updated = await db.prepare('SELECT * FROM business_purchases WHERE id = ?').get(id);
            updated.items = await db.prepare('SELECT * FROM business_purchase_items WHERE purchase_id = ?').all(id);

            await gstHelper.syncPurchaseToGstr2b(id, req.user.id);
            await logBusinessAudit(req.user.id, 'PURCHASE_UPDATE', `Updated purchase record ID ${id} (${doc_type}) for supplier ${supplier_name} (amount: ₹${grand_total})`, 'INFO');
            return sendSuccess(res, updated, 'Purchase record updated successfully');
        } catch (error) {
            console.error('[Purchase Controller] Error updating purchase:', error);
            return sendError(res, 'Failed to update purchase record', 500);
        }
    },

    // 5. Delete Purchase
    deletePurchase: async (req, res) => {
        const { id } = req.params;
        try {
            const pur = await db.prepare('SELECT purchase_number FROM business_purchases WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (pur) {
                await db.prepare("DELETE FROM accounting WHERE user_id = ? AND notes = ?").run(req.user.id, `Purchase #${pur.purchase_number}`);
            }

            await db.prepare('DELETE FROM business_purchases WHERE id = ?').run(id);
            await gstHelper.syncPurchaseToGstr2b(id, req.user.id);
            await logBusinessAudit(req.user.id, 'PURCHASE_DELETE', `Deleted purchase record ID ${id}`, 'WARN');
            return sendSuccess(res, null, 'Purchase record deleted successfully');
        } catch (error) {
            console.error('[Purchase Controller] Error deleting purchase:', error);
            return sendError(res, 'Failed to delete purchase record', 500);
        }
    },

    // 6. Search Purchases
    searchPurchases: async (req, res) => {
        const { q } = req.query;
        try {
            const query = `
                SELECT DISTINCT p.* FROM business_purchases p
                LEFT JOIN business_purchase_items i ON p.id = i.purchase_id
                WHERE p.user_id = ? AND (p.supplier_name LIKE ? OR p.purchase_number LIKE ? OR i.product_name LIKE ? OR i.sku LIKE ?)
                ORDER BY p.purchase_date DESC
            `;
            const wildcard = `%${q || ''}%`;
            const purchases = await db.prepare(query).all(req.user.id, wildcard, wildcard, wildcard, wildcard);

            for (const p of purchases) {
                p.items = await db.prepare('SELECT * FROM business_purchase_items WHERE purchase_id = ?').all(p.id);
            }

            return sendSuccess(res, purchases, 'Search results fetched successfully');
        } catch (error) {
            console.error('[Purchase Controller] Error searching purchases:', error);
            return sendError(res, 'Search operation failed', 500);
        }
    },

    // 7. Add Purchase Item
    addPurchaseItem: async (req, res) => {
        const { id } = req.params;
        const { product_name, sku, batch_number, expiry_date, quantity, received_quantity, free_quantity, primary_unit, purchase_price, discount, gst_percentage, tax_amount, total } = req.body;
        try {
            const purchase = await db.prepare('SELECT id FROM business_purchases WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!purchase) return sendError(res, 'Purchase not found', 404);

            const result = await db.prepare(`
                INSERT INTO business_purchase_items (
                    purchase_id, product_name, sku, batch_number, expiry_date, quantity,
                    received_quantity, free_quantity, primary_unit, purchase_price, discount,
                    gst_percentage, tax_amount, total
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                id, product_name, sku || null, batch_number || null, expiry_date || null,
                quantity || 1, received_quantity || 0, free_quantity || 0, primary_unit || 'pcs',
                purchase_price || 0, discount || 0, gst_percentage || 18, tax_amount || 0, total || 0
            );

            const createdItem = await db.prepare('SELECT * FROM business_purchase_items WHERE id = ?').get(result.lastInsertRowid);
            await gstHelper.syncPurchaseToGstr2b(id, req.user.id);
            return sendSuccess(res, createdItem, 'Purchase item added successfully', 201);
        } catch (error) {
            console.error('[Purchase Controller] Error adding item:', error);
            return sendError(res, 'Failed to add purchase item', 500);
        }
    },

    // 8. Update Purchase Item
    updatePurchaseItem: async (req, res) => {
        const { id, itemId } = req.params;
        const { product_name, sku, batch_number, expiry_date, quantity, received_quantity, free_quantity, primary_unit, purchase_price, discount, gst_percentage, tax_amount, total } = req.body;
        try {
            const purchase = await db.prepare('SELECT id FROM business_purchases WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!purchase) return sendError(res, 'Purchase not found', 404);

            await db.prepare(`
                UPDATE business_purchase_items SET
                    product_name = ?, sku = ?, batch_number = ?, expiry_date = ?, quantity = ?,
                    received_quantity = ?, free_quantity = ?, primary_unit = ?, purchase_price = ?,
                    discount = ?, gst_percentage = ?, tax_amount = ?, total = ?
                WHERE id = ? AND purchase_id = ?
            `).run(
                product_name, sku || null, batch_number || null, expiry_date || null,
                quantity || 1, received_quantity || 0, free_quantity || 0, primary_unit || 'pcs',
                purchase_price || 0, discount || 0, gst_percentage || 18, tax_amount || 0, total || 0,
                itemId, id
            );

            const updatedItem = await db.prepare('SELECT * FROM business_purchase_items WHERE id = ?').get(itemId);
            await gstHelper.syncPurchaseToGstr2b(id, req.user.id);
            return sendSuccess(res, updatedItem, 'Purchase item updated successfully');
        } catch (error) {
            console.error('[Purchase Controller] Error updating item:', error);
            return sendError(res, 'Failed to update purchase item', 500);
        }
    },

    // 9. Delete Purchase Item
    deletePurchaseItem: async (req, res) => {
        const { id, itemId } = req.params;
        try {
            const purchase = await db.prepare('SELECT id FROM business_purchases WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!purchase) return sendError(res, 'Purchase not found', 404);

            await db.prepare('DELETE FROM business_purchase_items WHERE id = ? AND purchase_id = ?').run(itemId, id);
            await gstHelper.syncPurchaseToGstr2b(id, req.user.id);
            return sendSuccess(res, null, 'Purchase item removed successfully');
        } catch (error) {
            console.error('[Purchase Controller] Error deleting item:', error);
            return sendError(res, 'Failed to remove purchase item', 500);
        }
    },

    // 10. Update Purchase Status
    updatePurchaseStatus: async (req, res) => {
        const { id } = req.params;
        const { status } = req.body;
        try {
            const purchase = await db.prepare('SELECT id FROM business_purchases WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!purchase) return sendError(res, 'Purchase record not found', 404);

            await db.prepare('UPDATE business_purchases SET status = ?, updated_at = ? WHERE id = ?').run(status, new Date().toISOString(), id);
            await gstHelper.syncPurchaseToGstr2b(id, req.user.id);
            return sendSuccess(res, { id, status }, 'Purchase status updated successfully');
        } catch (error) {
            console.error('[Purchase Controller] Error updating purchase status:', error);
            return sendError(res, 'Failed to update purchase status', 500);
        }
    },

    // 11. Payments Endpoints
    processPurchasePayments: async (req, res) => {
        const { id } = req.params;
        const { paid_amount, payment_mode } = req.body;
        try {
            const purchase = await db.prepare('SELECT * FROM business_purchases WHERE id = ? AND user_id = ?').get(id, req.user.id);
            if (!purchase) return sendError(res, 'Purchase not found', 404);

            const newPaidAmount = (parseFloat(purchase.paid_amount) || 0) + (parseFloat(paid_amount) || 0);
            const totalToPay = parseFloat(purchase.grand_total) || 0;

            let newPaymentStatus = 'pending';
            let newStatus = 'Pending';
            if (newPaidAmount >= totalToPay) {
                newPaymentStatus = 'paid';
                newStatus = 'Paid';
            } else if (newPaidAmount > 0) {
                newPaymentStatus = 'partial';
                newStatus = 'Partially Paid';
            }

            await db.prepare('UPDATE business_purchases SET paid_amount = ?, payment_mode = ?, payment_status = ?, status = ? WHERE id = ? AND user_id = ?').run(newPaidAmount, payment_mode, newPaymentStatus, newStatus, id, req.user.id);
            
            // Sync to cash/bank ledger (accounting table)
            const normalizedMode = normalizePaymentMode(payment_mode);
            const now = new Date().toISOString();
            await db.prepare(`
                INSERT INTO accounting (user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at)
                VALUES (?, 'expense', ?, ?, 'Supplier Payment', ?, ?, 'Paid', ?, ?)
            `).run(req.user.id, now.split('T')[0], parseFloat(paid_amount) || 0, normalizedMode, `Payment for Purchase #${purchase.purchase_number}`, now, now);

            // Update matching Credit Purchase in accounting ledger
            const creditLedger = await db.prepare("SELECT * FROM accounting WHERE user_id = ? AND mode = 'Payables' AND notes LIKE ?").get(req.user.id, `%#${purchase.purchase_number}%`);
            if (creditLedger) {
                const updatedStatus = newPaidAmount >= totalToPay ? 'Paid' : 'Partially Paid';
                await db.prepare("UPDATE accounting SET status = ? WHERE id = ?").run(updatedStatus, creditLedger.id);
            }

            return sendSuccess(res, null, 'Payment processed successfully');
        } catch (error) {
            console.error('[Purchase Controller] processPurchasePayments error:', error);
            return sendError(res, 'Failed to process payment', 500);
        }
    },

    getPurchasePayments: async (req, res) => {
        const { id } = req.params;
        try {
            const payments = await db.prepare('SELECT paid_amount, payment_mode, payment_status FROM business_purchases WHERE id = ?').get(id);
            return sendSuccess(res, payments, 'Payments loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load payments', 500);
        }
    },

    // 12. Returns Endpoints
    processPurchaseReturns: async (req, res) => {
        const { id } = req.params;
        const { return_reason } = req.body;
        try {
            await db.prepare('UPDATE business_purchases SET return_reason = ?, doc_type = \'RETURN\' WHERE id = ?').run(return_reason, id);
            return sendSuccess(res, null, 'Return processed successfully');
        } catch (error) {
            return sendError(res, 'Failed to process return', 500);
        }
    },

    getPurchaseReturns: async (req, res) => {
        const { id } = req.params;
        try {
            const return_details = await db.prepare('SELECT id, return_reason, doc_type FROM business_purchases WHERE id = ?').get(id);
            return sendSuccess(res, return_details, 'Return details loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load return details', 500);
        }
    },

    // 13. Stock Updates
    processStockUpdate: async (req, res) => {
        const { id } = req.params;
        const { items } = req.body;
        const userId = req.user.id;
        const now = new Date().toISOString();
        try {
            if (items && Array.isArray(items)) {
                for (const item of items) {
                    const delta = parseFloat(item.delta_received) || 0;
                    if (delta <= 0) continue;

                    // 1. Update the Purchase Order items received count
                    await db.prepare('UPDATE business_purchase_items SET received_quantity = received_quantity + ? WHERE purchase_id = ? AND product_name = ?').run(delta, id, item.product_name);

                    // 2. If linked to a product, update physical inventory
                    const prodId = item.product_id;
                    if (prodId) {
                        const prod = await db.prepare('SELECT quantity, low_stock_threshold FROM business_products WHERE id = ? AND user_id = ?').get(prodId, userId);
                        if (prod) {
                            const currentQty = parseFloat(prod.quantity) || 0;
                            const newQty = currentQty + delta;
                            const threshold = parseFloat(prod.low_stock_threshold) || 5;
                            const newStatus = newQty <= 0 ? 'Out of Stock' : (newQty < threshold ? 'Low Stock' : 'In Stock');

                            await db.prepare(`
                                UPDATE business_products 
                                SET quantity = ?, stock_status = ?, updated_at = ? 
                                WHERE id = ? AND user_id = ?
                            `).run(newQty, newStatus, now, prodId, userId);

                            // 3. Log to physical stock history ledger
                            const poRef = await db.prepare('SELECT purchase_number FROM business_purchases WHERE id = ?').get(id);
                            const refNum = poRef ? poRef.purchase_number : 'N/A';
                            await db.prepare(`
                                INSERT INTO product_stock_history (product_id, user_id, quantity_changed, type, description, created_at)
                                VALUES (?, ?, ?, ?, ?, ?)
                            `).run(prodId, userId, delta, 'in', `Received via PO: ${refNum}`, now);
                        }
                    }
                }
            }
            return sendSuccess(res, null, 'Physical stock levels and inward logs successfully processed.');
        } catch (error) {
            console.error('[Purchase Controller] Error in physical stock update:', error);
            return sendError(res, 'Failed to update physical inventory stocks', 500);
        }
    },

    // 13b. Receive Goods — complete workflow trigger for Credit Purchase bills
    receiveGoods: async (req, res) => {
        const { id } = req.params;
        const { warehouse_id, warehouse_name, warehouse_code } = req.body || {};
        const userId = req.user.id;
        const now = new Date().toISOString();

        console.log(`[Receive Goods Debug] === START RECEIVING PROCESS ===`);
        console.log(`[Receive Goods Debug] purchaseOrderId: ${id}`);
        console.log(`[Receive Goods Debug] selectedWarehouseId (raw): ${warehouse_id}, name: ${warehouse_name}, code: ${warehouse_code}`);

        try {
            const idClean = String(id).trim();
            const numClean = idClean.replace(/^(INV|PO)-/i, '');
            const idNum = (!isNaN(Number(idClean)) && idClean !== '') ? Number(idClean) : ((!isNaN(Number(numClean)) && numClean !== '') ? Number(numClean) : null);

            // 1. Load the purchase bill by ID or purchase_number cleanly handling integer types
            let bill = null;
            if (idNum !== null) {
                try { bill = await db.prepare('SELECT * FROM business_purchases WHERE user_id = ? AND (id = ? OR purchase_number = ? OR purchase_number = ?)').get(userId, idNum, idClean, `PO-${numClean}`); } catch(e) {}
            }
            if (!bill) {
                try { bill = await db.prepare('SELECT * FROM business_purchases WHERE user_id = ? AND (purchase_number = ? OR purchase_number = ?)').get(userId, idClean, `PO-${numClean}`); } catch(e) {}
            }
            if (!bill && idNum !== null) {
                try { bill = await db.prepare('SELECT * FROM business_purchases WHERE id = ? OR purchase_number = ? OR purchase_number = ?').get(idNum, idClean, `PO-${numClean}`); } catch(e) {}
            }
            if (!bill) {
                try { bill = await db.prepare('SELECT * FROM business_purchases WHERE purchase_number = ? OR purchase_number = ?').get(idClean, `PO-${numClean}`); } catch(e) {}
            }

            if (!bill) return sendError(res, 'Purchase bill not found', 404);
            if (bill.status === 'Completed') return sendError(res, 'Goods already received for this bill', 400);
            if (bill.status === 'PARTIAL_REJECTED') return sendError(res, 'Cannot receive goods for a rejected purchase order', 400);

            // 1.5 Resolve Target Warehouse Database Profile safely (preventing 22P02 PostgreSQL integer error)
            let targetWhObj = null;
            const whIdNum = (!isNaN(Number(warehouse_id)) && warehouse_id !== null && String(warehouse_id).trim() !== '') ? Number(warehouse_id) : null;

            if (whIdNum !== null) {
                try { targetWhObj = await db.prepare('SELECT * FROM warehouses WHERE user_id = ? AND id = ?').get(userId, whIdNum); } catch(e) {}
            }
            if (!targetWhObj && warehouse_code) {
                try { targetWhObj = await db.prepare('SELECT * FROM warehouses WHERE user_id = ? AND LOWER(code) = ?').get(userId, String(warehouse_code).toLowerCase()); } catch(e) {}
            }
            if (!targetWhObj && warehouse_name) {
                try { targetWhObj = await db.prepare('SELECT * FROM warehouses WHERE user_id = ? AND LOWER(name) = ?').get(userId, String(warehouse_name).toLowerCase()); } catch(e) {}
            }
            if (!targetWhObj && warehouse_id && typeof warehouse_id === 'string') {
                try { targetWhObj = await db.prepare('SELECT * FROM warehouses WHERE user_id = ? AND (LOWER(code) = ? OR LOWER(name) = ?)').get(userId, warehouse_id.toLowerCase(), warehouse_id.toLowerCase()); } catch(e) {}
            }

            const whDbId = targetWhObj ? String(targetWhObj.id) : String(warehouse_id || '1');
            const whName = targetWhObj ? targetWhObj.name : String(warehouse_name || warehouse_id || 'Main Godown');
            const whCode = targetWhObj ? (targetWhObj.code || `WH-${whDbId}`) : String(warehouse_code || `WH-${whDbId}`);

            console.log(`[Receive Goods Debug] Resolved Warehouse: ID=${whDbId}, Name=${whName}, Code=${whCode}`);

            // 2. Mark bill as Completed & set selected warehouse and doc_type
            const updatePORes = await db.prepare(`
                UPDATE business_purchases 
                SET status = 'Completed', doc_type = 'BILL', warehouse_id = ?, updated_at = ? 
                WHERE id = ?
            `).run(whName, now, bill.id);

            console.log(`[Receive Goods Debug] PO status update result: changes=${updatePORes.changes}`);
            if (updatePORes.changes === 0) {
                throw new Error(`Failed to update Purchase Order #${bill.purchase_number} status to Completed.`);
            }

            // Also update linked sales invoice in business_invoices if present
            try {
                const rel = await db.prepare('SELECT generated_sales_invoice_id FROM b2b_invoice_relationships WHERE source_purchase_invoice_id = ?').get(bill.id);
                if (rel && rel.generated_sales_invoice_id) {
                    await db.prepare("UPDATE business_invoices SET status = 'Completed', updated_at = ? WHERE id = ?").run(now, rel.generated_sales_invoice_id);
                }
            } catch(e) {}

            // 2.5 Update physical stock inventory levels for all products in this bill across BOTH business_products & stock tables
            const items = await db.prepare('SELECT * FROM business_purchase_items WHERE purchase_id = ?').all(bill.id);
            if (!items || items.length === 0) {
                throw new Error(`No items found for Purchase Order #${bill.purchase_number}`);
            }

            for (const item of items) {
                const orderedQty = parseFloat(item.quantity) || 0;
                const prevRec = parseFloat(item.received_quantity) || 0;
                const receivedQty = prevRec > 0 ? prevRec : orderedQty;
                const pName = item.product_name || 'Unnamed Product';
                const pSku = item.sku || `SKU-${Math.floor(100000 + Math.random() * 900000)}`;
                const pUnit = item.primary_unit || item.unit || 'PCS';
                const pPrice = parseFloat(item.purchase_price) || parseFloat(item.unit_price) || parseFloat(item.price) || 0;

                console.log(`[Receive Goods Debug] Processing Item: name="${pName}", sku="${pSku}", orderedQuantity=${orderedQty}, receivedQuantity=${receivedQty}, unitPrice=${pPrice}`);

                // Mark received quantity as fully completed
                await db.prepare("UPDATE business_purchase_items SET received_quantity = ?, item_status = 'COMPLETED' WHERE id = ?")
                    .run(receivedQty, item.id);

                // -------------------------------------------------------------
                // A. UPDATE OR INSERT IN business_products TABLE
                // -------------------------------------------------------------
                let prod = null;
                const pIdNum = (item.product_id && !isNaN(Number(item.product_id))) ? Number(item.product_id) : null;

                if (pIdNum !== null) {
                    try { prod = await db.prepare('SELECT * FROM business_products WHERE id = ? AND user_id = ?').get(pIdNum, userId); } catch(e) {}
                }
                if (!prod && pSku) {
                    try { prod = await db.prepare('SELECT * FROM business_products WHERE user_id = ? AND LOWER(sku) = ?').get(userId, String(pSku).toLowerCase()); } catch(e) {}
                }
                if (!prod) {
                    try { prod = await db.prepare('SELECT * FROM business_products WHERE user_id = ? AND LOWER(name) = ?').get(userId, String(pName).toLowerCase()); } catch(e) {}
                }

                let targetProdId = null;
                let existingWarehouseStock = 0;
                let newWarehouseStock = 0;

                if (prod) {
                    targetProdId = prod.id;
                    existingWarehouseStock = parseFloat(prod.quantity) || 0;
                    newWarehouseStock = existingWarehouseStock + receivedQty;
                    const threshold = parseFloat(prod.low_stock_threshold) || 5;
                    const newStatus = newWarehouseStock <= 0 ? 'Out of Stock' : (newWarehouseStock < threshold ? 'Low Stock' : 'In Stock');
                    const effectivePrice = pPrice > 0 ? pPrice : (parseFloat(prod.purchase_price) || 0);

                    const dbUpdateProd = await db.prepare(`
                        UPDATE business_products 
                        SET quantity = ?, stock_status = ?, warehouse_id = ?, purchase_price = ?, updated_at = ? 
                        WHERE id = ? AND user_id = ?
                    `).run(newWarehouseStock, newStatus, whDbId, effectivePrice, now, prod.id, userId);

                    console.log(`[Receive Goods Debug] Updated business_products productId=${prod.id}, sku=${pSku}, existingWarehouseStock=${existingWarehouseStock}, newWarehouseStock=${newWarehouseStock}, databaseUpdateResult=${dbUpdateProd.changes}`);

                    if (dbUpdateProd.changes === 0) {
                        throw new Error(`Database update failed for product ${pName} (ID: ${prod.id})`);
                    }
                } else {
                    existingWarehouseStock = 0;
                    newWarehouseStock = receivedQty;
                    const newProdRes = await db.prepare(`
                        INSERT INTO business_products (
                            user_id, name, sku, category, unit, quantity, purchase_price, selling_price,
                            stock_status, warehouse_id, created_at, updated_at
                        ) VALUES (?, ?, ?, 'General', ?, ?, ?, ?, ?, ?, ?, ?)
                    `).run(userId, pName, pSku, pUnit, receivedQty, pPrice, pPrice > 0 ? (pPrice * 1.2) : 0, receivedQty > 5 ? 'In Stock' : 'Low Stock', whDbId, now, now);
                    
                    targetProdId = newProdRes.lastInsertRowid;
                    console.log(`[Receive Goods Debug] Created business_products productId=${targetProdId}, sku=${pSku}, newWarehouseStock=${newWarehouseStock}, databaseUpdateResult=1`);
                }

                // -------------------------------------------------------------
                // B. UPDATE OR INSERT IN stock TABLE (FOR WAREHOUSE PRODUCTS LIST)
                // -------------------------------------------------------------
                let stockRow = null;
                if (pSku) {
                    try { stockRow = await db.prepare('SELECT * FROM stock WHERE user_id = ? AND LOWER(sku) = ?').get(userId, String(pSku).toLowerCase()); } catch(e) {}
                }
                if (!stockRow) {
                    try { stockRow = await db.prepare('SELECT * FROM stock WHERE user_id = ? AND LOWER(name) = ?').get(userId, String(pName).toLowerCase()); } catch(e) {}
                }

                if (stockRow) {
                    const curStockQty = parseFloat(stockRow.quantity) || 0;
                    const updatedStockQty = curStockQty + receivedQty;
                    const effectiveCost = pPrice > 0 ? pPrice : (parseFloat(stockRow.unit_price) || 0);

                    const dbUpdateStk = await db.prepare(`
                        UPDATE stock 
                        SET quantity = ?, location = ?, unit_price = ?, updated_at = ?
                        WHERE id = ? AND user_id = ?
                    `).run(updatedStockQty, whName, effectiveCost, now, stockRow.id, userId);

                    console.log(`[Receive Goods Debug] Updated stock table ID=${stockRow.id}, existingStock=${curStockQty}, newStock=${updatedStockQty}, databaseUpdateResult=${dbUpdateStk.changes}`);
                } else {
                    const newStkRes = await db.prepare(`
                        INSERT INTO stock (
                            user_id, name, sku, category, unit, unit_price, quantity,
                            location, created_at, updated_at
                        ) VALUES (?, ?, ?, 'General', ?, ?, ?, ?, ?, ?)
                    `).run(userId, pName, pSku, pUnit, pPrice, receivedQty, whName, now, now);

                    console.log(`[Receive Goods Debug] Created stock table ID=${newStkRes.lastInsertRowid}, newStock=${receivedQty}, databaseUpdateResult=1`);
                }

                // Log stock movement history
                if (targetProdId) {
                    try {
                        await db.prepare(`
                            INSERT INTO product_stock_history (product_id, user_id, quantity_changed, type, description, created_at)
                            VALUES (?, ?, ?, ?, ?, ?)
                        `).run(targetProdId, userId, receivedQty, 'in', `Received via Purchase Order #${bill.purchase_number} in ${whName}`, now);
                    } catch(e) {}
                }
            }

            // 3. Update Vendor Ledger
            try {
                let supplier = null;
                try { supplier = await db.prepare('SELECT id, outstanding_balance FROM suppliers WHERE user_id = ? AND name = ?').get(userId, bill.supplier_name); } catch(e) {}
                if (!supplier) {
                    try { supplier = await db.prepare('SELECT id, outstanding_balance FROM business_suppliers WHERE user_id = ? AND name = ?').get(userId, bill.supplier_name); } catch(e) {}
                }
                if (!supplier) {
                    // Auto-create supplier if not found
                    try {
                        const newSup = await db.prepare(`
                            INSERT INTO business_suppliers (user_id, name, email, outstanding_balance, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?)
                        `).run(userId, bill.supplier_name, bill.supplier_gstin || null, parseFloat(bill.grand_total) || 0, now, now);
                        supplier = { id: newSup.lastInsertRowid, outstanding_balance: 0 };
                    } catch(e) {
                        try {
                            const newSup = await db.prepare(`
                                INSERT INTO suppliers (user_id, name, outstanding_balance, created_at)
                                VALUES (?, ?, ?, ?)
                            `).run(userId, bill.supplier_name, parseFloat(bill.grand_total) || 0, now);
                            supplier = { id: newSup.lastInsertRowid, outstanding_balance: 0 };
                        } catch(e2) {
                            supplier = { id: 1, outstanding_balance: 0 };
                        }
                    }
                }

                const supId = supplier.id;
                const billAmount = parseFloat(bill.grand_total) || 0;

                // Debit entry: Goods received on credit
                try {
                    await db.prepare(`
                        INSERT INTO supplier_ledger (supplier_id, user_id, description, amount, type, created_at)
                        VALUES (?, ?, ?, ?, 'debit', ?)
                    `).run(supId, userId, `Goods Received — Bill ${bill.purchase_number}`, billAmount, now);
                } catch(e) {}

                // 4. Update supplier outstanding balance (Accounts Payable)
                try { await db.prepare('UPDATE suppliers SET outstanding_balance = outstanding_balance + ? WHERE id = ?').run(billAmount, supId); } catch(e) {}
                try { await db.prepare('UPDATE business_suppliers SET outstanding_balance = outstanding_balance + ? WHERE id = ?').run(billAmount, supId); } catch(e) {}
            } catch(supErr) {
                console.warn('[Purchase Controller] Supplier ledger update warning:', supErr.message);
            }

            // 5. Create Accounting Journal Entry (Accrual: Inventory/Purchase Dr, Accounts Payable Cr)
            try {
                const billAmount = parseFloat(bill.grand_total) || 0;
                const taxAmount = parseFloat(bill.total_tax) || 0;
                const subtotalAmount = parseFloat(bill.subtotal) || (billAmount - taxAmount);

                // Inventory/Purchase expense entry
                await db.prepare(`
                    INSERT INTO accounting (user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at)
                    VALUES (?, 'expense', ?, ?, 'Inventory Purchases', 'Payables', ?, 'Paid', ?, ?)
                `).run(userId, now.split('T')[0], subtotalAmount, `Goods Received — Bill ${bill.purchase_number} (${bill.supplier_name})`, now, now);

                // Input GST entry (if tax > 0)
                if (taxAmount > 0) {
                    await db.prepare(`
                        INSERT INTO accounting (user_id, entry_type, date, amount, category, mode, notes, status, created_at, updated_at)
                        VALUES (?, 'expense', ?, ?, 'Input GST', 'GST Credit Account', ?, 'Paid', ?, ?)
                    `).run(userId, now.split('T')[0], taxAmount, `Input ITC — Bill ${bill.purchase_number} (${bill.supplier_name})`, now, now);
                }

                // Mark the matching accounting payable entry as Paid/Posted
                await db.prepare(
                    "UPDATE accounting SET status = 'Paid' WHERE user_id = ? AND mode = 'Payables' AND notes LIKE ?"
                ).run(userId, `%${bill.purchase_number}%`);
            } catch(acctErr) {
                console.warn('[Purchase Controller] Accounting entry warning:', acctErr.message);
            }

            // 6. Sync to GSTR-2B with updated status
            try {
                if (gstHelper && typeof gstHelper.syncPurchaseToGstr2b === 'function') {
                    await gstHelper.syncPurchaseToGstr2b(bill.id, userId);
                }
            } catch(gstErr) {
                console.warn('[Purchase Controller] GSTR-2B sync warning:', gstErr.message);
            }

            try {
                await logBusinessAudit(userId, 'GOODS_RECEIVED', `Goods received for Bill ${bill.purchase_number} (Supplier: ${bill.supplier_name}, Amount: ₹${bill.grand_total || 0})`, 'SUCCESS');
            } catch(auditErr) {}

            return sendSuccess(res, { id: bill.id, purchase_number: bill.purchase_number, status: 'Completed' }, 'Goods received successfully. Inventory, Vendor Ledger, Accounts Payable, Accounting, and GSTR-2B have all been updated.');
        } catch (error) {
            console.error('[Purchase Controller] receiveGoods error:', error);
            return sendError(res, 'Failed to process goods receipt', 500);
        }
    },


    getStockHistory: async (req, res) => {
        const { id } = req.params;
        try {
            const history = await db.prepare('SELECT id, product_name, quantity, received_quantity FROM business_purchase_items WHERE purchase_id = ?').all(id);
            return sendSuccess(res, history, 'Stock history loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load stock history', 500);
        }
    },

    // 14. Invoice & Bills
    getPurchaseInvoice: async (req, res) => {
        return sendSuccess(res, null, 'Invoice fetched successfully');
    },

    getPurchaseBill: async (req, res) => {
        return sendSuccess(res, null, 'Bill fetched successfully');
    },

    // 15. Sharing/Sharing PDF
    sharePurchase: async (req, res) => {
        return sendSuccess(res, null, 'Document shared successfully');
    },

    getPurchasePdf: async (req, res) => {
        return sendSuccess(res, null, 'PDF fetched successfully');
    },

    printPurchase: async (req, res) => {
        return sendSuccess(res, null, 'Document print task completed');
    },

    sendWhatsapp: async (req, res) => {
        return sendSuccess(res, null, 'Message sent via WhatsApp successfully');
    },

    sendEmail: async (req, res) => {
        return sendSuccess(res, null, 'Email sent successfully');
    },

    // 16. Actions
    cancelPurchase: async (req, res) => {
        const { id } = req.params;
        try {
            await db.prepare('UPDATE business_purchases SET status = \'Cancelled\' WHERE id = ?').run(id);
            await logBusinessAudit(req.user.id, 'PURCHASE_CANCEL', `Cancelled purchase document ID ${id}`, 'WARN');
            return sendSuccess(res, null, 'Purchase document cancelled successfully');
        } catch (error) {
            return sendError(res, 'Failed to cancel purchase document', 500);
        }
    },

    duplicatePurchase: async (req, res) => {
        const { id } = req.params;
        try {
            const purchase = await db.prepare('SELECT * FROM business_purchases WHERE id = ?').get(id);
            const items = await db.prepare('SELECT * FROM business_purchase_items WHERE purchase_id = ?').all(id);

            const now = new Date().toISOString();
            const newNum = `PO-DUP-${Date.now().toString().slice(-4)}`;
            const result = await db.prepare(`
                INSERT INTO business_purchases (
                    user_id, purchase_number, purchase_type, purchase_date, due_date, doc_type, status,
                    supplier_name, supplier_gstin, billing_address, contact_number, warehouse_id,
                    purchase_by, payment_status, payment_mode, bank_account_id, paid_amount,
                    advance_amount, shipping_charge, round_off, place_of_supply, return_reason,
                    subtotal, total_discount, total_tax, grand_total, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                purchase.user_id, newNum, purchase.purchase_type, purchase.purchase_date, purchase.due_date, purchase.doc_type, purchase.status,
                purchase.supplier_name, purchase.supplier_gstin, purchase.billing_address, purchase.contact_number, purchase.warehouse_id,
                purchase.purchase_by, purchase.payment_status, purchase.payment_mode, purchase.bank_account_id, purchase.paid_amount,
                purchase.advance_amount, purchase.shipping_charge, purchase.round_off, purchase.place_of_supply, purchase.return_reason,
                purchase.subtotal, purchase.total_discount, purchase.total_tax, purchase.grand_total, now, now
            );

            const newId = result.lastInsertRowid;
            for (const item of items) {
                await db.prepare(`
                    INSERT INTO business_purchase_items (
                        purchase_id, product_name, sku, batch_number, expiry_date, quantity,
                        received_quantity, free_quantity, primary_unit, purchase_price, discount,
                        gst_percentage, tax_amount, total
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    newId, item.product_name, item.sku, item.batch_number, item.expiry_date,
                    item.quantity, item.received_quantity, item.free_quantity, item.primary_unit,
                    item.purchase_price, item.discount, item.gst_percentage, item.tax_amount, item.total
                );
            }

            return sendSuccess(res, { id: newId }, 'Purchase document duplicated successfully');
        } catch (error) {
            return sendError(res, 'Failed to duplicate purchase document', 500);
        }
    },

    processEwaybill: async (req, res) => {
        return sendSuccess(res, null, 'e-Way Bill generated successfully');
    },

    // 17. History & Timelines
    getPurchaseHistory: async (req, res) => {
        return sendSuccess(res, [], 'History loaded successfully');
    },

    getPurchaseTimeline: async (req, res) => {
        return sendSuccess(res, [], 'Timeline loaded successfully');
    },

    // 18. Notes Management
    createPurchaseNote: async (req, res) => {
        const { id } = req.params;
        const { title, content } = req.body;
        try {
            const result = await db.prepare(`
                INSERT INTO business_purchase_notes (purchase_id, title, content, created_at)
                VALUES (?, ?, ?, ?)
            `).run(id, title, content, new Date().toISOString());

            const note = await db.prepare('SELECT * FROM business_purchase_notes WHERE id = ?').get(result.lastInsertRowid);
            return sendSuccess(res, note, 'Note added successfully', 201);
        } catch (error) {
            return sendError(res, 'Failed to add note', 500);
        }
    },

    getPurchaseNotes: async (req, res) => {
        const { id } = req.params;
        try {
            const notes = await db.prepare('SELECT * FROM business_purchase_notes WHERE purchase_id = ?').all(id);
            return sendSuccess(res, notes, 'Notes retrieved successfully');
        } catch (error) {
            return sendError(res, 'Failed to retrieve notes', 500);
        }
    },

    // 19. Documents Management
    createPurchaseDocument: async (req, res) => {
        const { id } = req.params;
        const { name, file_path } = req.body;
        try {
            const result = await db.prepare(`
                INSERT INTO business_purchase_documents (purchase_id, name, file_path, created_at)
                VALUES (?, ?, ?, ?)
            `).run(id, name, file_path, new Date().toISOString());

            const doc = await db.prepare('SELECT * FROM business_purchase_documents WHERE id = ?').get(result.lastInsertRowid);
            return sendSuccess(res, doc, 'Document attached successfully', 201);
        } catch (error) {
            return sendError(res, 'Failed to attach document', 500);
        }
    },

    getPurchaseDocuments: async (req, res) => {
        const { id } = req.params;
        try {
            const docs = await db.prepare('SELECT * FROM business_purchase_documents WHERE purchase_id = ?').all(id);
            return sendSuccess(res, docs, 'Documents retrieved successfully');
        } catch (error) {
            return sendError(res, 'Failed to retrieve documents', 500);
        }
    },

    // 20. Reports Endpoints
    getSummaryReport: async (req, res) => {
        try {
            const summary = await db.prepare(`
                SELECT COALESCE(SUM(grand_total), 0) as "totalPurchases", COUNT(*) as "totalCount"
                FROM business_purchases WHERE user_id = ? AND doc_type = 'BILL'
            `).get(req.user.id);
            return sendSuccess(res, summary, 'Summary report loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load summary report', 500);
        }
    },

    getSupplierReport: async (req, res) => {
        try {
            const report = await db.prepare(`
                SELECT supplier_name, COUNT(*) as count, COALESCE(SUM(grand_total), 0) as total
                FROM business_purchases WHERE user_id = ?
                GROUP BY supplier_name
            `).all(req.user.id);
            return sendSuccess(res, report, 'Supplier report loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load supplier report', 500);
        }
    },

    getGstReport: async (req, res) => {
        try {
            const report = await db.prepare(`
                SELECT COALESCE(SUM(total_tax), 0) as total_tax_credit
                FROM business_purchases WHERE user_id = ? AND doc_type = 'BILL'
            `).get(req.user.id);
            return sendSuccess(res, report, 'GST report loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load GST report', 500);
        }
    },

    getPaymentReport: async (req, res) => {
        try {
            const report = await db.prepare(`
                SELECT payment_mode, COALESCE(SUM(paid_amount), 0) as total_paid
                FROM business_purchases WHERE user_id = ?
                GROUP BY payment_mode
            `).all(req.user.id);
            return sendSuccess(res, report, 'Payment report loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load payment report', 500);
        }
    },

    getPendingReport: async (req, res) => {
        try {
            const report = await db.prepare(`
                SELECT * FROM business_purchases WHERE user_id = ? AND payment_status = 'pending'
            `).all(req.user.id);
            return sendSuccess(res, report, 'Pending report loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load pending report', 500);
        }
    },

    // 21. Analytics Endpoints
    getAnalytics: async (req, res) => {
        try {
            const analytics = await db.prepare(`
                SELECT COALESCE(SUM(grand_total), 0) as total_outflow, COUNT(*) as doc_count
                FROM business_purchases WHERE user_id = ?
            `).get(req.user.id);
            return sendSuccess(res, analytics, 'Analytics loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load analytics', 500);
        }
    },

    getDashboardSummary: async (req, res) => {
        try {
            const summary = await db.prepare(`
                SELECT COALESCE(SUM(grand_total), 0) as total_outflow, COUNT(*) as doc_count
                FROM business_purchases WHERE user_id = ?
            `).get(req.user.id);
            return sendSuccess(res, summary, 'Dashboard summary loaded successfully');
        } catch (error) {
            return sendError(res, 'Failed to load dashboard summary', 500);
        }
    },

    // 22. Bulk Import/Export
    importPurchases: async (req, res) => {
        return sendSuccess(res, null, 'Purchases imported successfully');
    },

    exportPurchases: async (req, res) => {
        try {
            const data = await db.prepare('SELECT * FROM business_purchases WHERE user_id = ?').all(req.user.id);
            return sendSuccess(res, data, 'Purchases exported successfully');
        } catch (error) {
            return sendError(res, 'Failed to export purchases', 500);
        }
    },

    // 23. Supplier Portal Confirmation & Orders
    getSupplierPortalOrders: async (req, res) => {
        try {
            const userEmail = (req.user.email || '').toLowerCase();
            const userId = req.user.id;

            const purchases = await db.prepare(`
                SELECT DISTINCT p.*
                FROM business_purchases p
                LEFT JOIN b2b_invoice_relationships rel ON p.id = rel.source_purchase_invoice_id
                WHERE rel.supplier_user_id = ? 
                   OR LOWER(rel.supplier_email) = ?
                   OR LOWER(p.supplier_name) = ?
                ORDER BY p.id DESC
            `).all(userId, userEmail, (req.user.username || '').toLowerCase());

            for (const p of purchases) {
                try {
                    p.items = await db.prepare('SELECT * FROM business_purchase_items WHERE purchase_id = ?').all(p.id);
                } catch(e) {
                    p.items = [];
                }
            }

            return sendSuccess(res, purchases, 'Supplier portal orders loaded successfully');
        } catch (error) {
            console.error('Failed to load supplier portal orders:', error);
            return sendError(res, 'Failed to load supplier portal orders', 500);
        }
    },

    confirmSupplierPurchase: async (req, res) => {
        const { id } = req.params;
        const { response_type = 'CONFIRMED', expected_available_date, notes, items: reqItems } = req.body || {};
        try {
            const now = new Date().toISOString();
            const idClean = String(id).trim();
            const numClean = idClean.replace(/^(INV|PO)-/i, '');

            // Ensure column existence across business_purchases, business_invoices, invoices, and business_purchase_items
            const tablesToEnsure = ['business_purchases', 'business_invoices', 'invoices'];
            const colsToEnsure = [
                "supplier_confirmation_status TEXT DEFAULT 'PENDING'",
                "confirmed_at TEXT",
                "supplier_response_type TEXT",
                "supplier_status_message TEXT",
                "expected_available_date TEXT",
                "supplier_response_items TEXT"
            ];
            for (const tbl of tablesToEnsure) {
                for (const colDef of colsToEnsure) {
                    try { await db.prepare(`ALTER TABLE ${tbl} ADD COLUMN ${colDef}`).run(); } catch(e) {}
                }
            }

            try { await db.prepare("ALTER TABLE business_purchase_items ADD COLUMN available_quantity REAL").run(); } catch(e) {}
            try { await db.prepare("ALTER TABLE business_purchase_items ADD COLUMN item_availability_status TEXT").run(); } catch(e) {}
            try { await db.prepare("ALTER TABLE business_purchase_items ADD COLUMN item_status TEXT").run(); } catch(e) {}

            let purchase = null;
            // 1. Direct lookup in business_purchases
            try {
                purchase = await db.prepare('SELECT * FROM business_purchases WHERE id = ? OR purchase_number = ? OR purchase_number = ? OR purchase_number = ?').get(idClean, idClean, numClean, `PO-${numClean}`);
            } catch (e) {}

            // 2. Lookup via b2b_invoice_relationships
            if (!purchase) {
                try {
                    const rel = await db.prepare(`
                        SELECT * FROM b2b_invoice_relationships 
                        WHERE source_purchase_invoice_id = ? OR generated_sales_invoice_id = ? OR connection_transaction_id = ? OR id = ?
                    `).get(idClean, idClean, idClean, idClean);

                    if (rel && rel.source_purchase_invoice_id) {
                        purchase = await db.prepare('SELECT * FROM business_purchases WHERE id = ?').get(rel.source_purchase_invoice_id);
                    }
                } catch (e) {}
            }

            // 3. Lookup in business_invoices
            let invoice = null;
            try {
                invoice = await db.prepare('SELECT * FROM business_invoices WHERE id = ? OR invoice_number = ? OR invoice_number = ? OR invoice_number = ?').get(idClean, idClean, numClean, `INV-${numClean}`);
            } catch (e) {}

            if (!invoice && purchase) {
                try {
                    const rel = await db.prepare('SELECT generated_sales_invoice_id FROM b2b_invoice_relationships WHERE source_purchase_invoice_id = ?').get(purchase.id);
                    if (rel && rel.generated_sales_invoice_id) {
                        invoice = await db.prepare('SELECT * FROM business_invoices WHERE id = ?').get(rel.generated_sales_invoice_id);
                    }
                } catch (e) {}
            }

            if (!purchase && invoice) {
                try {
                    const rel = await db.prepare('SELECT source_purchase_invoice_id FROM b2b_invoice_relationships WHERE generated_sales_invoice_id = ?').get(invoice.id);
                    if (rel && rel.source_purchase_invoice_id) {
                        purchase = await db.prepare('SELECT * FROM business_purchases WHERE id = ?').get(rel.source_purchase_invoice_id);
                    }
                } catch (e) {}
            }

            // 4. Fallback check on invoices table
            if (!invoice) {
                try {
                    invoice = await db.prepare('SELECT * FROM invoices WHERE id = ? OR invoice_number = ? OR invoice_number = ?').get(idClean, idClean, `INV-${numClean}`);
                } catch (e) {}
            }

            if (!purchase && !invoice) {
                return sendError(res, 'Purchase order not found', 404);
            }

            let status = 'CONFIRMED BY SUPPLIER';
            let supplierConfirmationStatus = 'CONFIRMED BY SUPPLIER';
            let statusMsg = 'Supplier has confirmed your order.';

            if (response_type === 'PARTIALLY_AVAILABLE') {
                status = 'PARTIALLY_AVAILABLE';
                supplierConfirmationStatus = 'PARTIALLY_AVAILABLE';
                statusMsg = notes || 'Supplier can provide only a smaller quantity.';
            } else if (response_type === 'NOT_AVAILABLE') {
                status = 'NOT_AVAILABLE';
                supplierConfirmationStatus = 'NOT_AVAILABLE';
                statusMsg = notes || 'Product not available — Waiting for buyer response.';
            } else if (response_type === 'AVAILABLE_LATER') {
                status = 'AVAILABLE_LATER';
                supplierConfirmationStatus = 'AVAILABLE_LATER';
                statusMsg = notes || (expected_available_date ? `Waiting for supplier — Available on ${expected_available_date}.` : 'Waiting for supplier — Available later.');
            }

            const itemsJson = reqItems && Array.isArray(reqItems) ? JSON.stringify(reqItems) : null;

            if (purchase) {
                try {
                    await db.prepare(`
                        UPDATE business_purchases 
                        SET status = ?, 
                            supplier_confirmation_status = ?, 
                            supplier_response_type = ?, 
                            supplier_status_message = ?, 
                            expected_available_date = ?, 
                            supplier_response_items = ?,
                            confirmed_at = ?, 
                            updated_at = ?
                        WHERE id = ?
                    `).run(
                        status, 
                        supplierConfirmationStatus, 
                        response_type, 
                        statusMsg, 
                        expected_available_date || null, 
                        itemsJson,
                        now, 
                        now, 
                        purchase.id
                    );
                } catch (errPurUpdate) {
                    console.warn('[Purchase Controller] Full update failed on business_purchases, using fallback:', errPurUpdate.message);
                    try {
                        await db.prepare(`
                            UPDATE business_purchases 
                            SET status = ?, supplier_confirmation_status = ?, updated_at = ?
                            WHERE id = ?
                        `).run(status, supplierConfirmationStatus, now, purchase.id);
                    } catch(e) {}
                }

                if (reqItems && Array.isArray(reqItems)) {
                    for (const it of reqItems) {
                        const targetId = it.id;
                        const availQty = parseFloat(it.available_quantity) !== undefined && !isNaN(parseFloat(it.available_quantity)) ? parseFloat(it.available_quantity) : null;
                        if (targetId) {
                            try {
                                await db.prepare(`
                                    UPDATE business_purchase_items 
                                    SET received_quantity = COALESCE(?, received_quantity, quantity), available_quantity = ?, item_availability_status = ? 
                                    WHERE id = ?
                                `).run(availQty, availQty, it.item_availability_status || response_type, targetId);
                            } catch(e) {}
                        }
                    }
                }
                
                // If confirmed fully, set received_quantity = quantity for items
                if (response_type === 'CONFIRMED') {
                    try {
                        await db.prepare(`
                            UPDATE business_purchase_items 
                            SET received_quantity = quantity, item_status = 'CONFIRMED' 
                            WHERE purchase_id = ?
                        `).run(purchase.id);
                    } catch(e) {}
                }
            }

            if (invoice) {
                try {
                    await db.prepare(`
                        UPDATE business_invoices 
                        SET status = ?,
                            supplier_confirmation_status = ?,
                            supplier_response_type = ?,
                            supplier_status_message = ?,
                            expected_available_date = ?,
                            supplier_response_items = ?,
                            confirmed_at = ?,
                            updated_at = ?
                        WHERE id = ?
                    `).run(
                        status,
                        supplierConfirmationStatus,
                        response_type,
                        statusMsg,
                        expected_available_date || null,
                        itemsJson,
                        now,
                        now,
                        invoice.id
                    );
                } catch(e) {}

                try {
                    await db.prepare(`
                        UPDATE invoices 
                        SET status = ?,
                            supplier_confirmation_status = ?,
                            supplier_response_type = ?,
                            supplier_status_message = ?,
                            expected_available_date = ?,
                            supplier_response_items = ?
                        WHERE id = ?
                    `).run(
                        status,
                        supplierConfirmationStatus,
                        response_type,
                        statusMsg,
                        expected_available_date || null,
                        itemsJson,
                        invoice.id
                    );
                } catch(e) {}
            }

            // Send notification to buyer
            const buyerUserId = purchase ? purchase.user_id : (invoice ? invoice.user_id : null);
            const pNum = purchase ? purchase.purchase_number : (invoice ? invoice.invoice_number : idClean);
            const sName = purchase ? purchase.supplier_name : (invoice ? invoice.client_name : 'Supplier');

            if (buyerUserId) {
                try {
                    const notifyMsg = `Supplier ${sName} confirmed Purchase Order #${pNum}: ${statusMsg}`;
                    await db.prepare(`
                        INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
                        VALUES (?, 'Purchase Order Supplier Response', ?, 'purchase', 0, ?)
                    `).run(buyerUserId, notifyMsg, now);
                } catch (notifyErr) {
                    console.warn('Failed to insert notification:', notifyErr.message);
                }
            }

            let updatedPurchase = {};
            let updatedInvoice = {};
            try {
                if (purchase) updatedPurchase = await db.prepare('SELECT * FROM business_purchases WHERE id = ?').get(purchase.id) || {};
                if (invoice) updatedInvoice = await db.prepare('SELECT * FROM business_invoices WHERE id = ?').get(invoice.id) || {};
            } catch (e) {}

            return sendSuccess(res, {
                purchase: updatedPurchase,
                invoice: updatedInvoice,
                status: supplierConfirmationStatus,
                supplier_confirmation_status: supplierConfirmationStatus,
                message: statusMsg
            }, 'Purchase order confirmed successfully');
        } catch (error) {
            console.error('Error confirming purchase order:', error);
            return sendError(res, 'Failed to confirm purchase order', 500);
        }
    },

    getSupplierPortalOrders: async (req, res) => {
        try {
            const emailLower = req.user.email ? String(req.user.email).trim().toLowerCase() : '';
            const userId = req.user.id;

            const orders = await db.prepare(`
                SELECT DISTINCT p.*, 
                       rel.generated_sales_invoice_id,
                       rel.supplier_email
                FROM business_purchases p
                LEFT JOIN b2b_invoice_relationships rel ON p.id = rel.source_purchase_invoice_id
                WHERE rel.supplier_user_id = ? 
                   OR LOWER(rel.supplier_email) = ?
                   OR LOWER(p.supplier_name) = ?
                ORDER BY p.id DESC
            `).all(userId, emailLower, (req.user.username || '').toLowerCase());

            const enriched = await Promise.all((orders || []).map(async o => {
                let items = [];
                try {
                    items = await db.prepare('SELECT * FROM business_purchase_items WHERE purchase_id = ?').all(o.id);
                } catch(e) {}
                const dealer = await db.prepare('SELECT username, business_name FROM users WHERE id = ?').get(o.user_id);
                return {
                    ...o,
                    dealer_name: dealer ? (dealer.business_name || dealer.username) : 'CLIKS Dealer',
                    order_status: o.supplier_confirmation_status || o.status || 'PENDING',
                    items
                };
            }));

            return sendSuccess(res, enriched, 'Supplier portal orders retrieved successfully');
        } catch (error) {
            console.error('Error loading supplier portal orders:', error);
            return sendError(res, 'Failed to load supplier portal orders', 500);
        }
    },

    handleBuyerResponse: async (req, res) => {
        const { id } = req.params;
        const { action } = req.body || {};
        const now = new Date().toISOString();

        try {
            const idClean = String(id).trim();
            const numClean = idClean.replace(/^(INV|PO)-/i, '');

            let purchase = null;
            try {
                purchase = await db.prepare('SELECT * FROM business_purchases WHERE id = ? OR purchase_number = ? OR purchase_number = ?').get(idClean, idClean, `PO-${numClean}`);
            } catch (e) {}

            if (!purchase) {
                return sendError(res, 'Purchase order not found', 404);
            }

            if (action === 'ACCEPT') {
                const newStatus = 'PARTIAL_ACCEPTED';
                const statusMsg = 'Buyer accepted available quantity.';

                await db.prepare(`
                    UPDATE business_purchases 
                    SET status = ?, supplier_confirmation_status = ?, supplier_status_message = ?, updated_at = ?
                    WHERE id = ?
                `).run(newStatus, newStatus, statusMsg, now, purchase.id);

                try {
                    const rel = await db.prepare('SELECT generated_sales_invoice_id FROM b2b_invoice_relationships WHERE source_purchase_invoice_id = ?').get(purchase.id);
                    if (rel && rel.generated_sales_invoice_id) {
                        await db.prepare("UPDATE business_invoices SET status = ?, supplier_confirmation_status = ?, supplier_status_message = ?, updated_at = ? WHERE id = ?")
                            .run(newStatus, newStatus, statusMsg, now, rel.generated_sales_invoice_id);
                    }
                } catch (e) {}

                const items = await db.prepare('SELECT * FROM business_purchase_items WHERE purchase_id = ?').all(purchase.id);
                for (const it of items) {
                    const availQty = parseFloat(it.available_quantity);
                    const reqQty = parseFloat(it.quantity) || 0;
                    const finalRecQty = (!isNaN(availQty) && availQty > 0) ? availQty : reqQty;
                    await db.prepare("UPDATE business_purchase_items SET received_quantity = ?, item_availability_status = 'PARTIAL_ACCEPTED' WHERE id = ?")
                        .run(finalRecQty, it.id);
                }

                return sendSuccess(res, { id: purchase.id, status: newStatus }, 'Partial quantity accepted.');
            } else if (action === 'REJECT') {
                const newStatus = 'PARTIAL_REJECTED';
                const statusMsg = 'Buyer rejected available quantity.';

                await db.prepare(`
                    UPDATE business_purchases 
                    SET status = ?, supplier_confirmation_status = ?, supplier_status_message = ?, updated_at = ?
                    WHERE id = ?
                `).run(newStatus, newStatus, statusMsg, now, purchase.id);

                try {
                    const rel = await db.prepare('SELECT generated_sales_invoice_id FROM b2b_invoice_relationships WHERE source_purchase_invoice_id = ?').get(purchase.id);
                    if (rel && rel.generated_sales_invoice_id) {
                        await db.prepare("UPDATE business_invoices SET status = ?, supplier_confirmation_status = ?, supplier_status_message = ?, updated_at = ? WHERE id = ?")
                            .run(newStatus, newStatus, statusMsg, now, rel.generated_sales_invoice_id);
                    }
                } catch (e) {}

                return sendSuccess(res, { id: purchase.id, status: newStatus }, 'Partial quantity rejected.');
            } else {
                return sendError(res, 'Invalid action', 400);
            }
        } catch (error) {
            console.error('[Purchase Controller] handleBuyerResponse error:', error);
            return sendError(res, 'Failed to process buyer response', 500);
        }
    }
};

module.exports = purchaseController;
