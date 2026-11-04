const db = require('../db/connection');

/**
 * Normalizes payment mode to standard readable string
 */
function normalizePaymentMode(mode) {
    if (!mode) return 'Bank Transfer';
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
    if (m === 'bank' || m.includes('bank') || m.includes('neft') || m.includes('rtgs') || m.includes('cheque')) {
        return 'Bank Transfer';
    }
    return mode;
}

/**
 * Syncs a single purchase bill record into the expenses table.
 * Only syncs if doc_type is 'BILL'.
 */
async function syncPurchaseBillToExpense(purchase) {
    if (!purchase) return null;
    const docType = String(purchase.doc_type || '').toUpperCase();
    if (docType !== 'BILL') {
        return null;
    }

    try {
        const userId = purchase.user_id;
        const purchaseNumber = purchase.purchase_number || `BILL-${purchase.id}`;
        const grandTotal = parseFloat(purchase.grand_total) || 0;
        const totalTax = parseFloat(purchase.total_tax) || 0;
        const subtotal = parseFloat(purchase.subtotal) || (grandTotal - totalTax);
        const supplierName = purchase.supplier_name || 'Vendor';
        const rawDate = purchase.purchase_date || purchase.created_at || new Date().toISOString();
        const expenseDate = String(rawDate).split('T')[0];
        const paymentMode = normalizePaymentMode(purchase.payment_mode);
        const isPaid = purchase.payment_status === 'paid';
        const isPartiallyPaid = !isPaid && (parseFloat(purchase.paid_amount) > 0 || parseFloat(purchase.advance_amount) > 0);
        const expenseStatus = isPaid ? 'paid' : (isPartiallyPaid ? 'partially_paid' : 'pending');
        const itcStatus = totalTax > 0 ? 'Eligible (ITC Claimed)' : 'Not Applicable';
        const now = new Date().toISOString();

        // Calculate GST % approx if not explicitly available
        const gstPercentage = (subtotal > 0 && totalTax > 0) ? Math.round((totalTax / subtotal) * 100) : 0;

        // Check if an expense record already exists for this purchase bill
        const existing = await db.prepare(`
            SELECT id FROM expenses 
            WHERE user_id = ? AND (expense_number = ? OR transaction_reference = ?)
        `).get(userId, purchaseNumber, purchaseNumber);

        if (existing) {
            await db.prepare(`
                UPDATE expenses SET
                    amount = ?,
                    expense_amount = ?,
                    subtotal = ?,
                    tax_amount = ?,
                    gst_percentage = ?,
                    expense_date = ?,
                    expense_status = ?,
                    payee_name = ?,
                    payee_phone = ?,
                    payee_gstin = ?,
                    payment_mode = ?,
                    input_tax_credit = ?,
                    category_name = 'Inventory Purchases',
                    category = 'Inventory Purchases',
                    subcategory = ?,
                    updated_at = ?
                WHERE id = ? AND user_id = ?
            `).run(
                grandTotal,
                grandTotal,
                subtotal,
                totalTax,
                gstPercentage,
                expenseDate,
                expenseStatus,
                supplierName,
                purchase.contact_number || '',
                purchase.supplier_gstin || '',
                paymentMode,
                itcStatus,
                `Bill from ${supplierName}`,
                now,
                existing.id,
                userId
            );
            return existing.id;
        } else {
            const insertResult = await db.prepare(`
                INSERT INTO expenses (
                    user_id, amount, expense_number, expense_date, expense_status,
                    category_name, category, subcategory, payee_name, payee_phone,
                    payee_gstin, expense_amount, gst_percentage, subtotal, tax_amount,
                    payment_mode, transaction_reference, input_tax_credit,
                    is_claim, is_budget, is_recurring, created_at, updated_at,
                    description, branch_id
                ) VALUES (
                    ?, ?, ?, ?, ?,
                    'Inventory Purchases', 'Inventory Purchases', ?, ?, ?,
                    ?, ?, ?, ?, ?,
                    ?, ?, ?,
                    'false', 'false', 0, ?, ?,
                    ?, ?
                )
            `).run(
                userId,
                grandTotal,
                purchaseNumber,
                expenseDate,
                expenseStatus,
                `Bill from ${supplierName}`,
                supplierName,
                purchase.contact_number || '',
                purchase.supplier_gstin || '',
                grandTotal,
                gstPercentage,
                subtotal,
                totalTax,
                paymentMode,
                purchaseNumber,
                itcStatus,
                purchase.created_at || now,
                now,
                `Inventory Purchase Bill #${purchaseNumber}`,
                purchase.warehouse_id || null
            );
            return insertResult.lastInsertRowid;
        }
    } catch (err) {
        console.error('[purchaseExpenseSync] syncPurchaseBillToExpense error:', err);
        return null;
    }
}

/**
 * Auto-syncs all purchase bills for a user that do not yet exist in expenses table.
 * Perfect for retroactive syncing when bills were created previously.
 */
async function autoSyncAllUserPurchaseBills(userId) {
    if (!userId) return;
    try {
        const missingBills = await db.prepare(`
            SELECT p.* FROM business_purchases p
            WHERE p.user_id = ? 
              AND UPPER(p.doc_type) = 'BILL'
              AND NOT EXISTS (
                  SELECT 1 FROM expenses e 
                  WHERE e.user_id = p.user_id 
                    AND (e.transaction_reference = p.purchase_number OR e.expense_number = p.purchase_number)
              )
        `).all(userId);

        if (missingBills && missingBills.length > 0) {
            for (const bill of missingBills) {
                await syncPurchaseBillToExpense(bill);
            }
        }
    } catch (err) {
        console.error('[purchaseExpenseSync] autoSyncAllUserPurchaseBills error:', err);
    }
}

/**
 * Removes an expense linked to a deleted purchase bill
 */
async function deletePurchaseExpense(purchaseNumber, userId) {
    if (!purchaseNumber || !userId) return;
    try {
        await db.prepare(`
            DELETE FROM expenses 
            WHERE user_id = ? AND (expense_number = ? OR transaction_reference = ?)
        `).run(userId, purchaseNumber, purchaseNumber);
    } catch (err) {
        console.error('[purchaseExpenseSync] deletePurchaseExpense error:', err);
    }
}

module.exports = {
    syncPurchaseBillToExpense,
    autoSyncAllUserPurchaseBills,
    deletePurchaseExpense,
    normalizePaymentMode
};

