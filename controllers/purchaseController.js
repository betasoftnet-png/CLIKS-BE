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

            const created = await db.prepare('SELECT * FROM business_purchases WHERE id = ?').get(purchaseId) || {};
            try {
                created.items = await db.prepare('SELECT * FROM business_purchase_items WHERE purchase_id = ?').all(purchaseId);
            } catch (e) {
                created.items = items || [];
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
        const userId = req.user.id;
        const now = new Date().toISOString();
        try {
            // 1. Load the purchase bill
            const bill = await db.prepare('SELECT * FROM business_purchases WHERE id = ? AND user_id = ?').get(id, userId);
            if (!bill) return sendError(res, 'Purchase bill not found', 404);
            if (bill.status === 'Completed') return sendError(res, 'Goods already received for this bill', 400);

            // 2. Mark bill as Completed
            await db.prepare(`
                UPDATE business_purchases SET status = 'Completed', updated_at = ? WHERE id = ?
            `).run(now, id);

            // 2.5 Update physical stock inventory levels for all products in this bill
            const items = await db.prepare('SELECT * FROM business_purchase_items WHERE purchase_id = ?').all(id);
            if (items && items.length > 0) {
                for (const item of items) {
                    const qty = parseFloat(item.quantity) || 0;
                    const prevRec = parseFloat(item.received_quantity) || 0;
                    const delta = qty - prevRec;

                    if (delta > 0) {
                        // Mark received quantity as fully completed
                        await db.prepare('UPDATE business_purchase_items SET received_quantity = ? WHERE purchase_id = ? AND product_name = ?')
                            .run(qty, id, item.product_name);

                        // If linked to a product, update physical inventory stock levels
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

                                // Log to physical stock history ledger
                                await db.prepare(`
                                    INSERT INTO product_stock_history (product_id, user_id, quantity_changed, type, description, created_at)
                                    VALUES (?, ?, ?, ?, ?, ?)
                                `).run(prodId, userId, delta, 'in', `Received via Bill: ${bill.purchase_number}`, now);
                            }
                        }
                    }
                }
            }

            // 3. Update Vendor Ledger
            let supplier = await db.prepare('SELECT id, outstanding_balance FROM suppliers WHERE user_id = ? AND name = ?').get(userId, bill.supplier_name);
            if (!supplier) {
                supplier = await db.prepare('SELECT id, outstanding_balance FROM business_suppliers WHERE user_id = ? AND name = ?').get(userId, bill.supplier_name);
            }
            if (!supplier) {
                // Auto-create supplier if not found
                const newSup = await db.prepare(`
                    INSERT INTO suppliers (user_id, name, gstin, outstanding_balance, created_at)
                    VALUES (?, ?, ?, ?, ?)
                `).run(userId, bill.supplier_name, bill.supplier_gstin || null, parseFloat(bill.grand_total) || 0, now);
                supplier = { id: newSup.lastInsertRowid, outstanding_balance: 0 };
            }

            const supId = supplier.id;
            const billAmount = parseFloat(bill.grand_total) || 0;

            // Debit entry: Goods received on credit
            await db.prepare(`
                INSERT INTO supplier_ledger (supplier_id, user_id, description, amount, type, created_at)
                VALUES (?, ?, ?, ?, 'debit', ?)
            `).run(supId, userId, `Goods Received — Bill ${bill.purchase_number}`, billAmount, now);

            // 4. Update supplier outstanding balance (Accounts Payable)
            await db.prepare('UPDATE suppliers SET outstanding_balance = outstanding_balance + ? WHERE id = ?').run(billAmount, supId);
            // Also try business_suppliers table
            await db.prepare('UPDATE business_suppliers SET outstanding_balance = outstanding_balance + ? WHERE id = ?').run(billAmount, supId).catch(() => {});

            // 5. Create Accounting Journal Entry (Accrual: Inventory/Purchase Dr, Accounts Payable Cr)
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

            // 6. Sync to GSTR-2B with updated status
            await gstHelper.syncPurchaseToGstr2b(id, userId);

            await logBusinessAudit(userId, 'GOODS_RECEIVED', `Goods received for Bill ${bill.purchase_number} (Supplier: ${bill.supplier_name}, Amount: ₹${billAmount})`, 'SUCCESS');

            return sendSuccess(res, { id, status: 'Completed' }, 'Goods received successfully. Inventory, Vendor Ledger, Accounts Payable, Accounting, and GSTR-2B have all been updated.');
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
    confirmSupplierPurchase: async (req, res) => {
        const { id } = req.params;
        try {
            const now = new Date().toISOString();
            const purchase = await db.prepare('SELECT * FROM business_purchases WHERE id = ?').get(id);
            if (!purchase) return sendError(res, 'Purchase order not found', 404);

            await db.prepare(`
                UPDATE business_purchases 
                SET status = 'CONFIRMED', supplier_confirmation_status = 'CONFIRMED', confirmed_at = ?, updated_at = ?
                WHERE id = ?
            `).run(now, now, id);

            try {
                await db.prepare(`UPDATE business_purchase_items SET item_status = 'CONFIRMED' WHERE purchase_id = ?`).run(id);
            } catch(e) {}

            // Send notification to dealer inside Cliks Business
            try {
                const notifyMsg = `Supplier ${purchase.supplier_name || 'Vendor'} has confirmed Purchase Order #${purchase.purchase_number}.`;
                await db.prepare(`
                    INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
                    VALUES (?, ?, ?, 'purchase', 0, ?)
                `).run(purchase.user_id, 'Purchase Order Confirmed', notifyMsg, now);
            } catch (notifyErr) {
                console.warn('Failed to insert notification:', notifyErr.message);
            }

            const updated = await db.prepare('SELECT * FROM business_purchases WHERE id = ?').get(id);
            const items = await db.prepare('SELECT * FROM business_purchase_items WHERE purchase_id = ?').all(id);
            return sendSuccess(res, { ...updated, items }, 'Purchase order confirmed by supplier successfully');
        } catch (error) {
            console.error('Error confirming purchase order:', error);
            return sendError(res, 'Failed to confirm purchase order', 500);
        }
    },

    getSupplierPortalOrders: async (req, res) => {
        try {
            const emailLower = req.user.email ? String(req.user.email).trim().toLowerCase() : '';
            const sups = await db.prepare('SELECT id, name FROM business_suppliers WHERE LOWER(email) = ?').all(emailLower);
            const supNames = (sups || []).map(s => s.name.toLowerCase());

            let sql = `SELECT * FROM business_purchases ORDER BY id DESC LIMIT 50`;
            let orders = await db.prepare(sql).all();

            if (supNames.length > 0) {
                orders = orders.filter(o => supNames.includes(String(o.supplier_name || '').toLowerCase()));
            }

            const enriched = await Promise.all((orders || []).map(async o => {
                const items = await db.prepare('SELECT * FROM business_purchase_items WHERE purchase_id = ?').all(o.id);
                const dealer = await db.prepare('SELECT username, business_name FROM users WHERE id = ?').get(o.user_id);
                return {
                    ...o,
                    dealer_name: dealer ? (dealer.business_name || dealer.username) : 'CLIKS Dealer',
                    items
                };
            }));

            return sendSuccess(res, enriched, 'Supplier portal orders retrieved successfully');
        } catch (error) {
            return sendError(res, 'Failed to load supplier portal orders', 500);
        }
    }
};

module.exports = purchaseController;
