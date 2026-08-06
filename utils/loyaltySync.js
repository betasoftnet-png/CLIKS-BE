const db = require('../db/connection');

/**
 * Synchronizes a business invoice with the CLIKS Customer app.
 * Matches customer email, updates purchase history, loyalty wallet, and creates notification.
 */
async function syncInvoiceToCustomer(invoice) {
    if (!invoice.client_email) return;

    try {
        // 1. Find if a CLIKS user exists with this email
        const user = await db.prepare('SELECT id, username FROM users WHERE email = ?').get(invoice.client_email);
        if (!user) return; // No matching CLIKS customer account

        const userId = user.id;
        const now = new Date().toISOString();

        // 2. Calculate Loyalty Points (e.g., 1 point per 100 currency units)
        const pointsEarned = Math.floor(invoice.total_amount / 100);

        await db.transaction(async () => {
            // 3. Create/Update Loyalty Wallet
            const wallet = await db.prepare('SELECT id FROM loyalty_wallets WHERE user_id = ?').get(userId);
            let walletId;

            if (wallet) {
                walletId = wallet.id;
                await db.prepare(`
                    UPDATE loyalty_wallets
                    SET available_points = available_points + ?,
                        lifetime_earned = lifetime_earned + ?,
                        updated_at = ?
                    WHERE id = ?
                `).run(pointsEarned, pointsEarned, now, walletId);
            } else {
                const info = await db.prepare(`
                    INSERT INTO loyalty_wallets (user_id, available_points, lifetime_earned, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                `).run(userId, pointsEarned, pointsEarned, now, now);
                walletId = info.lastInsertRowid;
            }

            // 4. Record Loyalty Transaction
            await db.prepare(`
                INSERT INTO loyalty_transactions (wallet_id, invoice_id, merchant_id, type, points, description, date, created_at)
                VALUES (?, ?, ?, 'Earned', ?, ?, ?, ?)
            `).run(walletId, invoice.id, invoice.user_id, pointsEarned, `Earned from purchase at merchant #${invoice.user_id}`, invoice.created_at, now);

            // 5. Create Customer Purchase Record
            // Get Merchant Name (Business Name of the user who issued the invoice)
            const merchant = await db.prepare('SELECT business_name FROM users WHERE id = ?').get(invoice.user_id);
            const merchantName = merchant?.business_name || 'CLIKS Merchant';

            await db.prepare(`
                INSERT INTO customer_purchases (
                    user_id, business_invoice_id, merchant_name, invoice_number, invoice_date,
                    amount, tax_amount, discount, grand_total, payment_status, purchase_status,
                    points_earned, timestamp, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                userId, invoice.id, merchantName, invoice.invoice_number, invoice.created_at,
                invoice.amount, invoice.tax_amount, invoice.discount_amount, invoice.total_amount,
                invoice.status === 'Paid' ? 'Paid' : 'Pending', 'Completed',
                pointsEarned, now, now
            );

            // 6. Generate Notification
            await db.prepare(`
                INSERT INTO notifications (user_id, title, message, type, link, created_at)
                VALUES (?, ?, ?, 'Success', ?, ?)
            `).run(
                userId,
                'New Purchase Recorded',
                `Your purchase of ₹${invoice.total_amount.toLocaleString()} at ${merchantName} has been recorded. You earned ${pointsEarned} loyalty points!`,
                '/books/purchase-details',
                now
            );
        })();

        console.log(`[LoyaltySync] Successfully synced invoice ${invoice.invoice_number} to user ${user.username}`);
    } catch (err) {
        console.error('[LoyaltySync] Error during synchronization:', err);
    }
}

module.exports = { syncInvoiceToCustomer };
