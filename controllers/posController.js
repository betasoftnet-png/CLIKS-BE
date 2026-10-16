const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');
const { processCustomerInvoiceIntegration } = require('../utils/customerIntegration');
const { convertUnit } = require('../utils/unitConversion');

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

        let isLoyaltyEnabled = true;
        try {
            const lRow = await db.prepare('SELECT loyalty_enabled FROM business_loyalty_settings WHERE user_id = ?').get(userId);
            if (lRow && (lRow.loyalty_enabled === 0 || lRow.loyalty_enabled === false)) {
                isLoyaltyEnabled = false;
            } else if (!lRow) {
                const uRow = await db.prepare('SELECT settings FROM users WHERE id = ?').get(userId);
                if (uRow && uRow.settings) {
                    const parsed = JSON.parse(uRow.settings);
                    if (parsed.loyaltyEnabled === false || parsed.loyalty === false) {
                        isLoyaltyEnabled = false;
                    }
                }
            }
        } catch (e) {
            console.warn('[POS Controller] Error checking loyalty settings:', e.message);
        }

        const existingLoyaltyPoints = isLoyaltyEnabled ? (parseFloat(req.body.existing_loyalty_points ?? req.body.existingLoyaltyPoints ?? 0) || 0) : 0;
        let loyaltyPointsEarned = 0;
        let loyaltyPointsRedeemed = 0;
        let loyaltyDiscountAmount = 0;
        let remainingLoyaltyPoints = 0;

        if (isLoyaltyEnabled) {
            loyaltyPointsEarned = (req.body.loyalty_points_earned !== undefined && req.body.loyalty_points_earned !== null)
                ? (parseFloat(req.body.loyalty_points_earned) || 0)
                : ((req.body.loyaltyPointsEarned !== undefined && req.body.loyaltyPointsEarned !== null)
                    ? (parseFloat(req.body.loyaltyPointsEarned) || 0)
                    : (numTotal > 0 ? Math.round(numTotal * 0.1) : 0));
            loyaltyPointsRedeemed = parseFloat(req.body.loyalty_points_redeemed ?? req.body.loyaltyPointsRedeemed ?? 0) || 0;
            loyaltyDiscountAmount = parseFloat(req.body.loyalty_discount_amount || req.body.loyaltyDiscount || req.body.loyalty_discount || loyaltyPointsRedeemed || 0) || 0;
            remainingLoyaltyPoints = req.body.remaining_loyalty_points !== undefined
                ? parseFloat(req.body.remaining_loyalty_points)
                : (req.body.final_loyalty_points !== undefined
                    ? parseFloat(req.body.final_loyalty_points)
                    : Math.max(0, existingLoyaltyPoints - loyaltyPointsRedeemed + loyaltyPointsEarned));
        }

        const netPointsChange = isLoyaltyEnabled ? (loyaltyPointsEarned - loyaltyPointsRedeemed) : 0;
        let billedByName = (req.body.billed_by || req.body.billedBy || req.body.cashier_name || '').trim();
        if (!billedByName || billedByName.toLowerCase() === 'admin' || billedByName.toLowerCase() === 'cashier' || billedByName.toLowerCase() === 'system') {
            billedByName = req.user?.username || req.user?.name || req.user?.full_name || '';
            if (!billedByName && req.user?.id) {
                try {
                    const uRow = await db.prepare('SELECT username, business_name FROM users WHERE id = ?').get(req.user.id);
                    if (uRow) billedByName = uRow.username || uRow.business_name || '';
                } catch (e) { }
            }
            if (!billedByName && req.user?.email) {
                billedByName = req.user.email.split('@')[0];
            }
        }
        if (!billedByName) billedByName = 'Cashier';

        try { await db.prepare('ALTER TABLE business_customers ADD COLUMN loyalty_points REAL DEFAULT 0').run(); } catch (e) { }
        try { await db.prepare('ALTER TABLE business_invoices ADD COLUMN customer_id INTEGER').run(); } catch (e) { }
        try { await db.prepare('ALTER TABLE business_invoices ADD COLUMN existing_loyalty_points REAL DEFAULT 0').run(); } catch (e) { }
        try { await db.prepare('ALTER TABLE business_invoices ADD COLUMN loyalty_points_earned REAL DEFAULT 0').run(); } catch (e) { }
        try { await db.prepare('ALTER TABLE business_invoices ADD COLUMN loyalty_points_redeemed REAL DEFAULT 0').run(); } catch (e) { }
        try { await db.prepare('ALTER TABLE business_invoices ADD COLUMN loyalty_discount_amount REAL DEFAULT 0').run(); } catch (e) { }
        try { await db.prepare('ALTER TABLE business_invoices ADD COLUMN remaining_loyalty_points REAL DEFAULT 0').run(); } catch (e) { }
        try { await db.prepare('ALTER TABLE business_invoices ADD COLUMN billed_by TEXT').run(); } catch (e) { }
        try { await db.prepare('ALTER TABLE business_invoices ADD COLUMN shop_name TEXT').run(); } catch (e) { }
        try { await db.prepare('ALTER TABLE business_invoices ADD COLUMN shop_address TEXT').run(); } catch (e) { }
        try { await db.prepare('ALTER TABLE business_invoices ADD COLUMN shop_phone TEXT').run(); } catch (e) { }
        try { await db.prepare('ALTER TABLE business_invoices ADD COLUMN shop_email TEXT').run(); } catch (e) { }
        try { await db.prepare('ALTER TABLE business_invoices ADD COLUMN shop_gstin TEXT').run(); } catch (e) { }
        try { await db.prepare('ALTER TABLE business_invoices ADD COLUMN branch_id INTEGER').run(); } catch (e) { }
        try { await db.prepare('ALTER TABLE business_invoices ADD COLUMN branch_name TEXT').run(); } catch (e) { }

        // Resolve branch context (strict if Sub-ID)
        let effectiveBranchId = req.user.branch_id || req.body.branch_id || null;
        let branchRow = null;
        if (effectiveBranchId) {
            try {
                branchRow = await db.prepare('SELECT id, name, address, phone, email, gstin, invoice_prefix FROM branches WHERE id = ? AND user_id = ?').get(effectiveBranchId, userId);
            } catch (e) {}
        }
        if (!branchRow) {
            try {
                branchRow = await db.prepare('SELECT id, name, address, phone, email, gstin, invoice_prefix FROM branches WHERE user_id = ? AND is_main_branch = 1 LIMIT 1').get(userId);
            } catch (e) {}
        }
        if (branchRow) {
            effectiveBranchId = branchRow.id;
        }

        // 0. Check stock availability for all items before processing checkout
        for (const item of items) {
            const sellQty = parseFloat(item.quantity) || 0;
            const itemId = item.id;
            const itemName = item.name || item.description || '';
            const cleanName = itemName.toLowerCase().trim();

            let maxQty = null;

            // First check branch_stock if a branch is active
            if (effectiveBranchId && itemId) {
                try {
                    const bsRow = await db.prepare('SELECT quantity FROM branch_stock WHERE branch_id = ? AND product_id = ? AND user_id = ?').get(effectiveBranchId, itemId, userId);
                    if (bsRow) maxQty = parseFloat(bsRow.quantity) || 0;
                } catch (e) {}
            }

            if (maxQty === null && itemId) {
                if (item.source === 'products') {
                    const prod = await db.prepare('SELECT quantity FROM business_products WHERE id = ? AND user_id = ?').get([itemId, userId]);
                    if (prod) maxQty = parseFloat(prod.quantity) || 0;
                } else if (item.source === 'inventory') {
                    const inv = await db.prepare('SELECT quantity FROM inventory WHERE id = ? AND user_id = ?').get([itemId, userId]);
                    if (inv) maxQty = parseFloat(inv.quantity) || 0;
                } else if (item.source === 'stock') {
                    const stk = await db.prepare('SELECT quantity FROM stock WHERE id = ? AND user_id = ?').get([itemId, userId]);
                    if (stk) maxQty = parseFloat(stk.quantity) || 0;
                }
            }

            if (maxQty === null && itemId) {
                const prod = await db.prepare('SELECT quantity FROM business_products WHERE id = ? AND user_id = ?').get([itemId, userId]);
                if (prod) maxQty = parseFloat(prod.quantity) || 0;
                const inv = await db.prepare('SELECT quantity FROM inventory WHERE id = ? AND user_id = ?').get([itemId, userId]);
                if (inv && (maxQty === null || parseFloat(inv.quantity) > maxQty)) maxQty = parseFloat(inv.quantity) || 0;
                const stk = await db.prepare('SELECT quantity FROM stock WHERE id = ? AND user_id = ?').get([itemId, userId]);
                if (stk && (maxQty === null || parseFloat(stk.quantity) > maxQty)) maxQty = parseFloat(stk.quantity) || 0;
            }

            if (maxQty === null && cleanName) {
                const prod = await db.prepare('SELECT quantity FROM business_products WHERE LOWER(name) = ? AND user_id = ?').get([cleanName, userId]);
                if (prod) maxQty = parseFloat(prod.quantity) || 0;
                const inv = await db.prepare('SELECT quantity FROM inventory WHERE LOWER(name) = ? AND user_id = ?').get([cleanName, userId]);
                if (inv && (maxQty === null || parseFloat(inv.quantity) > maxQty)) maxQty = parseFloat(inv.quantity) || 0;
                const stk = await db.prepare('SELECT quantity FROM stock WHERE LOWER(name) = ? AND user_id = ?').get([cleanName, userId]);
                if (stk && (maxQty === null || parseFloat(stk.quantity) > maxQty)) maxQty = parseFloat(stk.quantity) || 0;
            }

            // Check raw materials availability if item is a group product
            let bpItemForCheck = null;
            if (itemId) {
                bpItemForCheck = await db.prepare('SELECT id, is_group_product, raw_materials FROM business_products WHERE id = ? AND user_id = ?').get([itemId, userId]);
            }
            if (!bpItemForCheck && cleanName) {
                bpItemForCheck = await db.prepare('SELECT id, is_group_product, raw_materials FROM business_products WHERE LOWER(name) = ? AND user_id = ?').get([cleanName, userId]);
            }
            if (bpItemForCheck && (bpItemForCheck.is_group_product || bpItemForCheck.raw_materials)) {
                let checkRms = [];
                try {
                    checkRms = typeof bpItemForCheck.raw_materials === 'string' ? JSON.parse(bpItemForCheck.raw_materials) : (bpItemForCheck.raw_materials || []);
                } catch (e) { }

                if (Array.isArray(checkRms) && checkRms.length > 0) {
                    for (const rm of checkRms) {
                        const rmQty = parseFloat(rm.quantity) || 0;
                        const totalRmNeeded = rmQty * sellQty;
                        const rmUnit = rm.unit || 'PCS';
                        const rmId = rm.product_id || rm.id;
                        const rmName = rm.name || 'Raw Material';

                        if (totalRmNeeded > 0) {
                            let rmProd = null;
                            if (rmId) rmProd = await db.prepare('SELECT quantity, unit FROM business_products WHERE id = ? AND user_id = ?').get([rmId, userId]);
                            if (!rmProd && rmName) rmProd = await db.prepare('SELECT quantity, unit FROM business_products WHERE LOWER(name) = ? AND user_id = ?').get([rmName.toLowerCase().trim(), userId]);

                            if (rmProd) {
                                const rawStockUnit = rmProd.unit || rmUnit;
                                const deductQty = convertUnit(totalRmNeeded, rmUnit, rawStockUnit);
                                const avail = parseFloat(rmProd.quantity) || 0;
                                if (deductQty > avail) {
                                    return sendError(res, `Cannot complete checkout. Insufficient stock for ingredient "${rmName}". Needed: ${deductQty} ${rawStockUnit}, Available: ${avail} ${rawStockUnit} (for ${sellQty}x "${itemName}").`, 400);
                                }
                            }
                        }
                    }
                }
            }

            const isItemUnlimited = Boolean(item.isUnlimited || (maxQty !== null && maxQty >= 999000));
            if (!isItemUnlimited && maxQty !== null && sellQty > maxQty) {
                return sendError(res, `Cannot complete checkout. Requested quantity (${sellQty}) for "${itemName}" exceeds available stock (${maxQty}).`, 400);
            }
        }

        // Resolve shop information from request body or merchant user profile/settings
        let userRow = null;
        try {
            userRow = await db.prepare('SELECT business_name, settings, email FROM users WHERE id = ?').get(userId);
        } catch (e) { }

        let userSettingsObj = {};
        if (userRow?.settings) {
            try { userSettingsObj = JSON.parse(userRow.settings); } catch (e) { }
        }

        const resolvedShopName = branchRow?.name || req.body.shop_name || userSettingsObj.pos_shop_name || userSettingsObj.companyName || userRow?.business_name || null;
        const resolvedShopAddress = branchRow?.address || req.body.shop_address || userSettingsObj.pos_shop_address || userSettingsObj.registeredAddress || null;
        const resolvedShopPhone = branchRow?.phone || req.body.shop_phone || userSettingsObj.pos_shop_phone || userSettingsObj.phone || null;
        const resolvedShopEmail = branchRow?.email || req.body.shop_email || userSettingsObj.pos_shop_email || userSettingsObj.email || userRow?.email || null;
        const resolvedShopGstin = branchRow?.gstin || req.body.shop_gstin || userSettingsObj.pos_shop_gstin || userSettingsObj.gstinRef || null;

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
                        billed_by, shop_name, shop_address, shop_phone, shop_email, shop_gstin, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run([
                    userId, invoiceNumber, client_name || 'Walk-in Customer', client_email || null, customerId,
                    numAmount, numTax, numTotal, numPaid, numDue,
                    numDiscount, numRoundOff, 'Paid', now.split('T')[0], payment_mode || 'Cash',
                    'POS', JSON.stringify(items), existingLoyaltyPoints, loyaltyPointsEarned,
                    loyaltyPointsRedeemed, loyaltyDiscountAmount, remainingLoyaltyPoints,
                    billedByName, resolvedShopName, resolvedShopAddress, resolvedShopPhone, resolvedShopEmail, resolvedShopGstin, now, now
                ]);
                invoiceId = result.lastInsertRowid || result.id;
            } catch (errIns) {
                try {
                    // Fallback without shop columns if migration pending
                    const result = await db.prepare(`
                        INSERT INTO business_invoices (
                            user_id, invoice_number, client_name, client_email, customer_id,
                            amount, tax_amount, total_amount, paid_amount, due_amount,
                            discount_amount, round_off, status, due_date, payment_mode,
                            invoice_type, items, existing_loyalty_points, loyalty_points_earned, 
                            loyalty_points_redeemed, loyalty_discount_amount, remaining_loyalty_points, 
                            billed_by, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `).run([
                        userId, invoiceNumber, client_name || 'Walk-in Customer', client_email || null, customerId,
                        numAmount, numTax, numTotal, numPaid, numDue,
                        numDiscount, numRoundOff, 'Paid', now.split('T')[0], payment_mode || 'Cash',
                        'POS', JSON.stringify(items), existingLoyaltyPoints, loyaltyPointsEarned,
                        loyaltyPointsRedeemed, loyaltyDiscountAmount, remainingLoyaltyPoints,
                        billedByName, now, now
                    ]);
                    invoiceId = result.lastInsertRowid || result.id;
                } catch (legacyErr) {
                    const result = await db.prepare(`
                        INSERT INTO business_invoices (
                            user_id, invoice_number, client_name, client_email,
                            amount, tax_amount, total_amount, paid_amount, due_amount,
                            discount_amount, round_off, status, due_date, payment_mode,
                            invoice_type, items, loyalty_points_earned, loyalty_points_redeemed, billed_by, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `).run([
                        userId, invoiceNumber, client_name || 'Walk-in Customer', client_email || null,
                        numAmount, numTax, numTotal, numPaid, numDue,
                        numDiscount, numRoundOff, 'Paid', now.split('T')[0], payment_mode || 'Cash',
                        'POS', JSON.stringify(items), loyaltyPointsEarned, loyaltyPointsRedeemed, billedByName, now, now
                    ]);
                    invoiceId = result.lastInsertRowid || result.id;
                }
            }

            // 1.5 Atomically update Customer Loyalty Points in database upon successful payment
            let freshLoyaltyBalance = remainingLoyaltyPoints;
            if (loyaltyPointsEarned > 0 || loyaltyPointsRedeemed > 0) {
                try {
                    let updatedCount = 0;
                    const parsedCustId = customerId ? parseInt(customerId) : null;

                    if (parsedCustId && !isNaN(parsedCustId)) {
                        const res = await db.prepare(`
                            UPDATE business_customers 
                            SET loyalty_points = MAX(0, COALESCE(loyalty_points, 0) + ?), updated_at = ? 
                            WHERE id = ? AND user_id = ?
                        `).run([netPointsChange, now, parsedCustId, userId]);
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

                    // Fetch fresh persisted loyalty_points balance directly from business_customers table
                    let updatedCustRow = null;
                    if (parsedCustId && !isNaN(parsedCustId)) {
                        updatedCustRow = await db.prepare('SELECT id, loyalty_points FROM business_customers WHERE id = ? AND user_id = ?').get(parsedCustId, userId);
                    }
                    if (!updatedCustRow && client_email) {
                        updatedCustRow = await db.prepare('SELECT id, loyalty_points FROM business_customers WHERE LOWER(email) = ? AND user_id = ?').get(String(client_email).toLowerCase().trim(), userId);
                    }
                    if (!updatedCustRow && client_name && client_name !== 'Walk-in Customer') {
                        updatedCustRow = await db.prepare('SELECT id, loyalty_points FROM business_customers WHERE LOWER(name) = ? AND user_id = ?').get(String(client_name).toLowerCase().trim(), userId);
                    }

                    if (updatedCustRow && updatedCustRow.loyalty_points !== undefined && updatedCustRow.loyalty_points !== null) {
                        freshLoyaltyBalance = parseFloat(updatedCustRow.loyalty_points) || 0;
                    }
                } catch (errLoyalty) {
                    console.error('[POS Controller] Error updating customer loyalty points:', errLoyalty);
                }
            }

            // 2. Comprehensive multi-table stock deduction for each sold item
            for (const item of items) {
                const itemId = item.id;
                const itemName = item.name || item.description || '';
                const cleanName = itemName.toLowerCase().trim();
                const sellQty = parseFloat(item.quantity) || 1;

                try {
                    // 2a. Update business_products (Inventory -> Products)
                    let prodItem = null;
                    if (itemId && item.source === 'products') {
                        prodItem = await db.prepare('SELECT id, quantity, low_stock_threshold, is_group_product, raw_materials FROM business_products WHERE id = ? AND user_id = ?').get([itemId, userId]);
                    }
                    if (!prodItem && itemId) {
                        prodItem = await db.prepare('SELECT id, quantity, low_stock_threshold, is_group_product, raw_materials FROM business_products WHERE id = ? AND user_id = ?').get([itemId, userId]);
                    }
                    if (!prodItem && cleanName) {
                        prodItem = await db.prepare('SELECT id, quantity, low_stock_threshold, is_group_product, raw_materials FROM business_products WHERE LOWER(name) = ? AND user_id = ?').get([cleanName, userId]);
                    }

                    if (prodItem) {
                        const currentQty = parseFloat(prodItem.quantity) || 0;
                        const lowThreshold = parseFloat(prodItem.low_stock_threshold) || 5;
                        const newQty = Math.max(0, currentQty - sellQty);
                        const newStatus = newQty <= 0 ? 'Out of Stock' : (newQty <= lowThreshold ? 'Low Stock' : 'In Stock');

                        await db.prepare(`
                            UPDATE business_products 
                            SET quantity = ?, stock_status = ?, updated_at = ? 
                            WHERE id = ? AND user_id = ?
                        `).run([newQty, newStatus, now, prodItem.id, userId]);

                        // Also decrement from branch_stock for effectiveBranchId
                        if (effectiveBranchId) {
                            try {
                                const bsExist = await db.prepare('SELECT id, quantity FROM branch_stock WHERE branch_id = ? AND product_id = ? AND user_id = ?')
                                    .get(effectiveBranchId, prodItem.id, userId);
                                if (bsExist) {
                                    const newBranchQty = Math.max(0, (parseFloat(bsExist.quantity) || 0) - sellQty);
                                    await db.prepare('UPDATE branch_stock SET quantity = ?, updated_at = ? WHERE id = ?')
                                        .run(newBranchQty, now, bsExist.id);
                                } else {
                                    await db.prepare(`
                                        INSERT INTO branch_stock (user_id, branch_id, product_id, quantity, low_stock_threshold, created_at, updated_at)
                                        VALUES (?, ?, ?, ?, ?, ?, ?)
                                    `).run(userId, effectiveBranchId, prodItem.id, Math.max(0, currentQty - sellQty), lowThreshold, now, now);
                                }
                            } catch (bsErr) {
                                console.warn('[POS Controller] Error updating branch_stock:', bsErr.message);
                            }
                        }
                    }

                    // 2b. Update inventory table (Inventory -> Items)
                    let invItem = null;
                    if (itemId && item.source === 'inventory') {
                        invItem = await db.prepare('SELECT id, quantity FROM inventory WHERE id = ? AND user_id = ?').get([itemId, userId]);
                    }
                    if (!invItem && itemId) {
                        invItem = await db.prepare('SELECT id, quantity FROM inventory WHERE id = ? AND user_id = ?').get([itemId, userId]);
                    }
                    if (!invItem && cleanName) {
                        invItem = await db.prepare('SELECT id, quantity FROM inventory WHERE LOWER(name) = ? AND user_id = ?').get([cleanName, userId]);
                    }

                    if (invItem) {
                        const currentQty = parseFloat(invItem.quantity) || 0;
                        const newQty = Math.max(0, currentQty - sellQty);
                        const newStatus = newQty <= 0 ? 'Out of Stock' : (newQty < 10 ? 'Low Stock' : 'In Stock');

                        await db.prepare('UPDATE inventory SET quantity = ?, status = ?, updated_at = ? WHERE id = ? AND user_id = ?')
                            .run([newQty, newStatus, now, invItem.id, userId]);
                    }

                    // 2c. Update stock table (Inventory -> Stock registry)
                    let stockItem = null;
                    if (itemId && item.source === 'stock') {
                        stockItem = await db.prepare('SELECT id, quantity FROM stock WHERE id = ? AND user_id = ?').get([itemId, userId]);
                    }
                    if (!stockItem && itemId) {
                        stockItem = await db.prepare('SELECT id, quantity FROM stock WHERE id = ? AND user_id = ?').get([itemId, userId]);
                    }
                    if (!stockItem && cleanName) {
                        stockItem = await db.prepare('SELECT id, quantity FROM stock WHERE LOWER(name) = ? AND user_id = ?').get([cleanName, userId]);
                    }

                    if (stockItem) {
                        const currentQty = parseFloat(stockItem.quantity) || 0;
                        const newQty = Math.max(0, currentQty - sellQty);
                        await db.prepare('UPDATE stock SET quantity = ?, updated_at = ? WHERE id = ? AND user_id = ?')
                            .run([newQty, now, stockItem.id, userId]);

                        await db.prepare(`
                            INSERT INTO stock_transactions (stock_id, user_id, type, quantity, date, created_at)
                            VALUES (?, ?, 'out', ?, ?, ?)
                        `).run([stockItem.id, userId, sellQty, now, now]);
                    }

                    // 2d. Group Product: Deduct raw materials/ingredients stock
                    let groupItem = prodItem;
                    if (!groupItem && itemId) {
                        groupItem = await db.prepare('SELECT id, is_group_product, raw_materials FROM business_products WHERE id = ? AND user_id = ?').get([itemId, userId]);
                    }
                    if (!groupItem && cleanName) {
                        groupItem = await db.prepare('SELECT id, is_group_product, raw_materials FROM business_products WHERE LOWER(name) = ? AND user_id = ?').get([cleanName, userId]);
                    }

                    if (groupItem && (groupItem.is_group_product || groupItem.raw_materials)) {
                        let parsedRms = [];
                        try {
                            parsedRms = typeof groupItem.raw_materials === 'string' ? JSON.parse(groupItem.raw_materials) : (groupItem.raw_materials || []);
                        } catch (e) { }

                        if (Array.isArray(parsedRms) && parsedRms.length > 0) {
                            for (const rm of parsedRms) {
                                const rmQty = parseFloat(rm.quantity) || 0;
                                const totalRmNeeded = rmQty * sellQty;
                                const rmUnit = rm.unit || 'PCS';
                                const rmId = rm.product_id || rm.id;
                                const rmName = rm.name || '';

                                if (totalRmNeeded > 0 && (rmId || rmName)) {
                                    let rmProd = null;
                                    if (rmId) {
                                        rmProd = await db.prepare('SELECT id, name, unit, quantity, low_stock_threshold FROM business_products WHERE id = ? AND user_id = ?').get([rmId, userId]);
                                    }
                                    if (!rmProd && rmName) {
                                        rmProd = await db.prepare('SELECT id, name, unit, quantity, low_stock_threshold FROM business_products WHERE LOWER(name) = ? AND user_id = ?').get([rmName.toLowerCase().trim(), userId]);
                                    }

                                    if (rmProd) {
                                        const rawStockUnit = rmProd.unit || rmUnit;
                                        const deductQty = convertUnit(totalRmNeeded, rmUnit, rawStockUnit);
                                        const currentQty = parseFloat(rmProd.quantity) || 0;
                                        const newQty = Math.max(0, currentQty - deductQty);
                                        const lowThreshold = parseFloat(rmProd.low_stock_threshold) || 5;
                                        const newStatus = newQty <= 0 ? 'Out of Stock' : (newQty <= lowThreshold ? 'Low Stock' : 'In Stock');

                                        await db.prepare('UPDATE business_products SET quantity = ?, stock_status = ?, updated_at = ? WHERE id = ? AND user_id = ?')
                                            .run([newQty, newStatus, now, rmProd.id, userId]);

                                        try {
                                            const rmInv = await db.prepare('SELECT id, quantity, unit FROM inventory WHERE (id = ? OR LOWER(name) = ?) AND user_id = ?').get([rmProd.id, rmProd.name.toLowerCase().trim(), userId]);
                                            if (rmInv) {
                                                const invUnit = rmInv.unit || rawStockUnit;
                                                const invDeduct = convertUnit(totalRmNeeded, rmUnit, invUnit);
                                                const invCurrent = parseFloat(rmInv.quantity) || 0;
                                                const invNew = Math.max(0, invCurrent - invDeduct);
                                                const invStatus = invNew <= 0 ? 'Out of Stock' : (invNew < 10 ? 'Low Stock' : 'In Stock');
                                                await db.prepare('UPDATE inventory SET quantity = ?, status = ?, updated_at = ? WHERE id = ? AND user_id = ?')
                                                    .run([invNew, invStatus, now, rmInv.id, userId]);
                                            }
                                        } catch (e) { }

                                        try {
                                            const rmStock = await db.prepare('SELECT id, quantity, unit FROM stock WHERE (id = ? OR LOWER(name) = ?) AND user_id = ?').get([rmProd.id, rmProd.name.toLowerCase().trim(), userId]);
                                            if (rmStock) {
                                                const stkUnit = rmStock.unit || rawStockUnit;
                                                const stkDeduct = convertUnit(totalRmNeeded, rmUnit, stkUnit);
                                                const stkCurrent = parseFloat(rmStock.quantity) || 0;
                                                const stkNew = Math.max(0, stkCurrent - stkDeduct);
                                                await db.prepare('UPDATE stock SET quantity = ?, updated_at = ? WHERE id = ? AND user_id = ?')
                                                    .run([stkNew, now, rmStock.id, userId]);

                                                await db.prepare(`
                                                    INSERT INTO stock_transactions (stock_id, user_id, type, quantity, date, created_at)
                                                    VALUES (?, ?, 'out', ?, ?, ?)
                                                `).run([rmStock.id, userId, stkDeduct, now, now]);
                                            }
                                        } catch (e) { }
                                    }
                                }
                            }
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
                createdInvoice.remaining_loyalty_points = freshLoyaltyBalance;
                createdInvoice.final_loyalty_points = freshLoyaltyBalance;
                createdInvoice.updated_customer_loyalty_points = freshLoyaltyBalance;
                createdInvoice.billed_by = createdInvoice.billed_by || billedByName;
                createdInvoice.shop_name = createdInvoice.shop_name || resolvedShopName;
                createdInvoice.shop_address = createdInvoice.shop_address || resolvedShopAddress;
                createdInvoice.shop_phone = createdInvoice.shop_phone || resolvedShopPhone;
                createdInvoice.shop_email = createdInvoice.shop_email || resolvedShopEmail;
                createdInvoice.shop_gstin = createdInvoice.shop_gstin || resolvedShopGstin;
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

            // Automatic warranty tracking for warranty-enabled products
            try {
                const { processWarrantyForCompletedSale } = require('../utils/warrantyHelper');
                await processWarrantyForCompletedSale({
                    userId,
                    invoiceNumber,
                    customerName: client_name || 'Walk-in Customer',
                    items,
                    purchaseDate: now
                });
            } catch (warrErr) {
                console.error('[POS Controller] Warranty sync notice:', warrErr.message || warrErr);
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
        const { limit = 50, offset = 0, customer_id, client_name } = req.query;
        try {
            let query = `SELECT * FROM business_invoices WHERE user_id = ? AND invoice_type = 'POS'`;
            const params = [userId];
            if (customer_id && customer_id !== 'null' && customer_id !== 'undefined') {
                query += ` AND (customer_id = ? OR customer_id = CAST(? AS TEXT))`;
                params.push(customer_id, customer_id);
            } else if (client_name) {
                query += ` AND LOWER(client_name) = ?`;
                params.push(client_name.toLowerCase().trim());
            }
            query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
            params.push(parseInt(limit), parseInt(offset));

            const orders = await db.prepare(query).all(params);

            let defaultShopInfo = {};
            try {
                const uRow = await db.prepare('SELECT business_name, settings, email FROM users WHERE id = ?').get(userId);
                if (uRow?.settings) {
                    try {
                        const sObj = JSON.parse(uRow.settings);
                        defaultShopInfo = {
                            shop_name: sObj.pos_shop_name || sObj.companyName || uRow.business_name || null,
                            shop_address: sObj.pos_shop_address || sObj.registeredAddress || null,
                            shop_phone: sObj.pos_shop_phone || sObj.phone || null,
                            shop_email: sObj.pos_shop_email || sObj.email || uRow.email || null,
                            shop_gstin: sObj.pos_shop_gstin || sObj.gstinRef || null,
                        };
                    } catch (e) { }
                } else if (uRow?.business_name) {
                    defaultShopInfo = { shop_name: uRow.business_name };
                }
            } catch (e) { }

            const formattedOrders = orders.map(order => {
                try {
                    order.items = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || []);
                } catch (e) {
                    order.items = [];
                }
                order.shop_name = order.shop_name || defaultShopInfo.shop_name;
                order.shop_address = order.shop_address || defaultShopInfo.shop_address;
                order.shop_phone = order.shop_phone || defaultShopInfo.shop_phone;
                order.shop_email = order.shop_email || defaultShopInfo.shop_email;
                order.shop_gstin = order.shop_gstin || defaultShopInfo.shop_gstin;
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
