const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

const customerPurchaseController = {
    // 1. Get Purchase History for authenticated customer
    getPurchaseHistory: async (req, res) => {
        try {
            const userId = req.user.id;
            const userEmail = req.user.email ? String(req.user.email).trim().toLowerCase() : '';

            const purchases = await db.prepare(`
                SELECT * FROM customer_purchase_history 
                WHERE customer_user_id = ? OR LOWER(customer_email) = ?
                ORDER BY created_at DESC, id DESC
            `).all(userId, userEmail);

            const resultList = Array.isArray(purchases) ? purchases : [];

            resultList.forEach(p => {
                if (p.items && typeof p.items === 'string') {
                    try { p.items = JSON.parse(p.items); } catch (e) { p.items = []; }
                }
            });

            return sendSuccess(res, resultList, 'Customer purchase history loaded successfully');
        } catch (error) {
            console.error('[Customer Purchase Controller] getPurchaseHistory error:', error);
            return sendError(res, 'Failed to fetch purchase history', 500);
        }
    },

    // 2. Get Customer Loyalty Wallet and Transactions
    getLoyaltyWallet: async (req, res) => {
        try {
            const userId = req.user.id;

            let wallet = await db.prepare(
                'SELECT * FROM customer_loyalty_wallets WHERE user_id = ?'
            ).get(userId);

            if (!wallet) {
                const user = await db.prepare('SELECT loyalty_points FROM users WHERE id = ?').get(userId);
                const pts = (user && user.loyalty_points) || 0;
                wallet = {
                    user_id: userId,
                    points_balance: pts,
                    total_earned: pts,
                    total_redeemed: 0
                };
            }

            const transactions = await db.prepare(`
                SELECT * FROM customer_loyalty_transactions 
                WHERE user_id = ?
                ORDER BY created_at DESC, id DESC
            `).all(userId);

            return sendSuccess(res, {
                wallet,
                transactions: Array.isArray(transactions) ? transactions : []
            }, 'Loyalty wallet fetched successfully');
        } catch (error) {
            console.error('[Customer Purchase Controller] getLoyaltyWallet error:', error);
            return sendError(res, 'Failed to fetch loyalty wallet', 500);
        }
    }
};

module.exports = customerPurchaseController;
