const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { processCustomerInvoiceIntegration } = require('../utils/customerIntegration');

const posController = {
    // POS Checkout: Create Invoice and Decrement stock
    checkout: async (req, res) => {
        const {
            client_name, client_email,
            amount, tax_amount, total_amount, paid_amount, due_amount,
            discount_amount, round_off, payment_mode, items
        } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return sendError(res, 'At least one item is required for checkout', 400);
        }

        const userId = req.user.id;
        const now = new Date().toISOString();
        const invoiceNumber = `POS-${Date.now().toString().slice(-6)}`;

        const numAmount = parseFloat(amount) || 0;
        const numTax = parseFloat(tax_amount) || 0;
        const numTotal = parseFloat(total_amount) || 0;
        const numPaid = parseFloat(paid_amount) || numTotal;
        const numDue = parseFloat(due_amount) || 0;
        const numDiscount = parseFloat(discount_amount) || 0;
        const numRoundOff = parseFloat(round_off) || 0;

        const existingLoyaltyPoints = parseFloat(req.body.existing_loyalty_points || req.body.existingLoyaltyPoints || 0) || 0;
        const loyaltyPointsEarned = parseFloat(req.body.loyalty_points_earned || req.body.loyaltyPointsEarned || 0) || 0;
        const loyaltyPointsRedeemed = parseFloat(req.body.loyalty_points_redeemed || req.body.loyaltyPointsRedeemed || 0) || 0;
        const loyaltyDiscountAmount = parseFloat(req.body.loyalty_discount_amount || req.body.loyaltyDiscount || req.body.loyalty_discount || loyaltyPointsRedeemed || 0) || 0;
        const remainingLoyaltyPoints = req.body.remaining_loyalty_points !== undefined 
            ? parseFloat(req.body.remaining_loyalty_points) 
            : (req.body.final_loyalty_points !== undefined 
                ? parseFloat(req.body.final_loyalty_points) 
                : Math.max(0, existingLoyaltyPoints - loyaltyPointsRedeemed + loyaltyPointsEarned));
        
        const netPointsChange = loyaltyPointsEarned - loyaltyPointsRedeemed;
        const customerId = req.body.customer_id || null;

        // Ensure columns exist
        try { await db.prepare('ALTER TABLE business_invoices ADD COLUMN customer_id INTEGER').run(); } catch (e) { }
        try { await db.prepare('ALTER TABLE business_invoices ADD COLUMN existing_loyalty_points REAL DEFAULT 0').run(); } catch (e) { }
        try { await db.prepare('ALTER TABLE business_invoices ADD COLUMN loyalty_points_earned REAL DEFAULT 0').run(); } catch (e) { }
        try { await db.prepare('ALTER TABLE business_invoices ADD COLUMN loyalty_points_redeemed REAL DEFAULT 0').run(); } catch (e) { }
        try { await db.prepare('ALTER TABLE business_invoices ADD COLUMN loyalty_discount_amount REAL DEFAULT 0').run(); } catch (e) { }
        try { await db.prepare('ALTER TABLE business_invoices ADD COLUMN remaining_loyalty_points REAL DEFAULT 0').run(); } catch (e) { }

        try {
            // 1. Insert into business_invoices
            let invoiceId;
            try {
                const result = await db.prepare(`
                    INSERT INTO business_invoices (
                        user_id, invoice_number, client_name, client_email, customer_id,
                        amount, tax_amount, total_amount, paid_amount, due_amount,
                        discount_amount, round_off, status, due_date, payment_mode,
                        invoice_type, items, existing_loyalty_points, loyalty_points_earned, 
                        loyalty_points_redeemed, loyalty_discount_amount, remaining_loyalty_points, 
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run([
                    userId, invoiceNumber, client_name || 'Walk-in Customer', client_email || null, customerId,
                    numAmount, numTax, numTotal, numPaid, numDue,
                    numDiscount, numRoundOff, 'Paid', now.split('T')[0], payment_mode || 'Cash',
                    'POS', JSON.stringify(items), existingLoyaltyPoints, loyaltyPointsEarned, 
                    loyaltyPointsRedeemed, loyaltyDiscountAmount, remainingLoyaltyPoints, 
                    now, now
                ]);
                invoiceId = result.lastInsertRowid || result.id;
            } catch (errIns) {
                // Fallback insert if columns missing on legacy table
                const result = await db.prepare(`
                    INSERT INTO business_invoices (
                        user_id, invoice_number, client_name, client_email,
                        amount, tax_amount, total_amount, paid_amount, due_amount,
                        discount_amount, round_off, status, due_date, payment_mode,
                        invoice_type, items, loyalty_points_earned, loyalty_points_redeemed, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run([
                    userId, invoiceNumber, client_name || 'Walk-in Customer', client_email || null,
                    numAmount, numTax, numTotal, numPaid, numDue,
                    numDiscount, numRoundOff, 'Paid', now.split('T')[0], payment_mode || 'Cash',
                    'POS', JSON.stringify(items), loyaltyPointsEarned, loyaltyPointsRedeemed, now, now
                ]);
                invoiceId = result.lastInsertRowid || result.id;
            }

            // 1.5 Atomically update Customer Loyalty Points in database upon successful payment
            if (loyaltyPointsEarned > 0 || loyaltyPointsRedeemed > 0) {
                try {
                    let updatedCount = 0;
                    if (customerId) {
                        const res = await db.prepare(`
                            UPDATE business_customers 
                            SET loyalty_points = MAX(0, COALESCE(loyalty_points, 0) + ?), updated_at = ? 
                            WHERE id = ? AND user_id = ?
                        `).run([netPointsChange, now, customerId, userId]);
                        updatedCount = res?.changes || 0;
                    }

                    if (!updatedCount && client_email) {
                        const res = await db.prepare(`
                            UPDATE business_customers 
                            SET loyalty_points = MAX(0, COALESCE(loyalty_points, 0) + ?), updated_at = ? 
                            WHERE LOWER(email) = ? AND user_id = ?
                        `).run([netPointsChange, now, String(client_email).toLowerCase().trim(), userId]);
                        updatedCount = res?.changes || 0;
                    }

                    if (!updatedCount && client_name && client_name !== 'Walk-in Customer') {
                        await db.prepare(`
                            UPDATE business_customers 
                            SET loyalty_points = MAX(0, COALESCE(loyalty_points, 0) + ?), updated_at = ? 
                            WHERE LOWER(name) = ? AND user_id = ?
                        `).run([netPointsChange, now, String(client_name).toLowerCase().trim(), userId]);
                    }
                } catch (errLoyalty) {
                    console.error('[POS Controller] Error updating customer loyalty points:', errLoyalty);
                }
            }

            // 2. Update stock in correct inventory/products table for each item
            for (const item of items) {
                const itemId = item.id;
                if (!itemId) continue;

                const sellQty = parseFloat(item.quantity) || 1;

                try {
                    const prodItem = await db.prepare('SELECT quantity, low_stock_threshold FROM business_products WHERE id = ? AND user_id = ?')
                        .get([itemId, userId]);

                    if (prodItem) {
                        const currentQty = parseFloat(prodItem.quantity) || 0;
                        const lowThreshold = parseFloat(prodItem.low_stock_threshold) || 5;
                        const newQty = Math.max(0, currentQty - sellQty);
                        const newStatus = newQty <= 0 ? 'Out of Stock' : (newQty <= lowThreshold ? 'Low Stock' : 'In Stock');

                        await db.prepare(`
                            UPDATE business_products 
                            SET quantity = ?, stock_status = ?, updated_at = ? 
                            WHERE id = ? AND user_id = ?
                        `).run([newQty, newStatus, now, itemId, userId]);
                    } else {
                        const invItem = await db.prepare('SELECT quantity FROM inventory WHERE id = ? AND user_id = ?')
                            .get([itemId, userId]);

                        if (invItem) {
                            const currentQty = parseFloat(invItem.quantity) || 0;
                            const newQty = Math.max(0, currentQty - sellQty);
                            const newStatus = newQty <= 0 ? 'Out of Stock' : (newQty < 10 ? 'Low Stock' : 'In Stock');

                            await db.prepare('UPDATE inventory SET quantity = ?, status = ?, updated_at = ? WHERE id = ? AND user_id = ?')
                                .run([newQty, newStatus, now, itemId, userId]);
                        }
                    }
                } catch (errStock) {
                    console.error('[POS Controller] Error updating stock for item:', itemId, errStock);
                }
            }

            let createdInvoice = await db.prepare('SELECT * FROM business_invoices WHERE id = ?').get(invoiceId);
            if (createdInvoice) {
                if (createdInvoice.items) {
                    try { createdInvoice.items = JSON.parse(createdInvoice.items); } catch (e) { }
                }
                createdInvoice.existing_loyalty_points = createdInvoice.existing_loyalty_points !== undefined && createdInvoice.existing_loyalty_points !== null ? parseFloat(createdInvoice.existing_loyalty_points) : existingLoyaltyPoints;
                createdInvoice.loyalty_points_earned = createdInvoice.loyalty_points_earned !== undefined && createdInvoice.loyalty_points_earned !== null ? parseFloat(createdInvoice.loyalty_points_earned) : loyaltyPointsEarned;
                createdInvoice.loyalty_points_redeemed = createdInvoice.loyalty_points_redeemed !== undefined && createdInvoice.loyalty_points_redeemed !== null ? parseFloat(createdInvoice.loyalty_points_redeemed) : loyaltyPointsRedeemed;
                createdInvoice.loyalty_discount_amount = createdInvoice.loyalty_discount_amount !== undefined && createdInvoice.loyalty_discount_amount !== null ? parseFloat(createdInvoice.loyalty_discount_amount) : loyaltyDiscountAmount;
                createdInvoice.remaining_loyalty_points = createdInvoice.remaining_loyalty_points !== undefined && createdInvoice.remaining_loyalty_points !== null ? parseFloat(createdInvoice.remaining_loyalty_points) : remainingLoyaltyPoints;
                createdInvoice.final_loyalty_points = createdInvoice.remaining_loyalty_points;
            }

            // Real-time integration to CLIKS Customer Application
            try {
                await processCustomerInvoiceIntegration({
                    createdInvoice,
                    merchantUserId: userId
                });
            } catch (syncErr) {
                console.error('[POS Controller] Sync notice:', syncErr);
            }

            return sendSuccess(res, createdInvoice, 'POS checkout completed successfully', 201);
        } catch (error) {
            console.error('[POS Controller] Checkout error:', error);
            return sendError(res, 'Failed to process POS checkout', 500);
        }
    },

    // POS Analytics / Today's Summary
    getTodaySummary: async (req, res) => {
        const userId = req.user.id;
        try {
            const today = new Date().toISOString().split('T')[0];
            const invoices = await db.prepare(`
                SELECT total_amount, payment_mode 
                FROM business_invoices 
                WHERE user_id = ? AND invoice_type = 'POS' AND created_at LIKE ?
            `).all([userId, `${today}%`]);

            let total_orders = 0;
            let total_sales = 0;
            let cash_sales = 0;
            let upi_sales = 0;
            let card_sales = 0;

            if (Array.isArray(invoices)) {
                total_orders = invoices.length;
                invoices.forEach(inv => {
                    const amt = parseFloat(inv.total_amount) || 0;
                    total_sales += amt;
                    if (inv.payment_mode === 'Cash') cash_sales += amt;
                    else if (inv.payment_mode === 'UPI') upi_sales += amt;
                    else if (inv.payment_mode === 'Card') card_sales += amt;
                });
            }

            return sendSuccess(res, {
                total_orders,
                total_sales,
                cash_sales,
                upi_sales,
                card_sales
            }, 'Today summary retrieved');
        } catch (error) {
            console.error('[POS Controller] Summary error:', error);
            return sendError(res, 'Failed to fetch summary', 500);
        }
    },

    getOrders: async (req, res) => {
        const userId = req.user.id;
        const { limit = 50, offset = 0 } = req.query;
        try {
            const orders = await db.prepare(`
                SELECT * FROM business_invoices 
                WHERE user_id = ? AND invoice_type = 'POS' 
                ORDER BY created_at DESC 
                LIMIT ? OFFSET ?
            `).all([userId, parseInt(limit), parseInt(offset)]);

            const formattedOrders = orders.map(order => {
                try {
                    order.items = JSON.parse(order.items);
                } catch (e) {
                    order.items = [];
                }
                return order;
            });

            return sendSuccess(res, formattedOrders, 'POS order history retrieved');
        } catch (error) {
            console.error('[POS Controller] Orders history error:', error);
            return sendError(res, 'Failed to fetch order history', 500);
        }
    }
};

module.exports = posController;
