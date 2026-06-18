const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

const businessWalletController = {
    getWallet: async (req, res) => {
        try {
            const userId = req.user.id;

            // Fetch wallet or create if it doesn't exist
            let wallet = await db.prepare('SELECT * FROM business_wallets WHERE user_id = ?').get(userId);
            
            if (!wallet) {
                const now = new Date().toISOString();
                const result = await db.prepare(
                    'INSERT INTO business_wallets (user_id, balance, reward_points, created_at, updated_at) VALUES (?, 0, 0, ?, ?)'
                ).run(userId, now, now);
                wallet = await db.prepare('SELECT * FROM business_wallets WHERE id = ?').get(result.lastInsertRowid);
            }

            // Fetch transactions
            const transactions = await db.prepare(
                'SELECT * FROM business_wallet_transactions WHERE wallet_id = ? ORDER BY id DESC'
            ).all(wallet.id);

            return sendSuccess(res, { wallet, history: transactions }, 'Wallet fetched successfully');
        } catch (error) {
            console.error('[Business Wallet Controller] Error fetching wallet:', error);
            return sendError(res, 'Failed to fetch wallet details', 500);
        }
    },

    addMoney: async (req, res) => {
        const { amount, description, transaction_ref } = req.body;
        if (!amount || amount <= 0) return sendError(res, 'Valid amount is required', 400);

        try {
            const userId = req.user.id;
            const now = new Date().toISOString();

            return await db.transaction(async () => {
                let wallet = await db.prepare('SELECT * FROM business_wallets WHERE user_id = ?').get(userId);
                if (!wallet) {
                    const result = await db.prepare(
                        'INSERT INTO business_wallets (user_id, balance, reward_points, created_at, updated_at) VALUES (?, 0, 0, ?, ?)'
                    ).run(userId, now, now);
                    wallet = await db.prepare('SELECT * FROM business_wallets WHERE id = ?').get(result.lastInsertRowid);
                }

                // Update balance
                await db.prepare(
                    'UPDATE business_wallets SET balance = balance + ?, updated_at = ? WHERE id = ?'
                ).run(amount, now, wallet.id);

                // Add transaction
                await db.prepare(
                    'INSERT INTO business_wallet_transactions (wallet_id, type, amount, description, transaction_ref, created_at) VALUES (?, ?, ?, ?, ?, ?)'
                ).run(wallet.id, 'CREDIT', amount, description || 'Funds Added', transaction_ref || `TXN-${Date.now()}`, now);

                const updatedWallet = await db.prepare('SELECT * FROM business_wallets WHERE user_id = ?').get(userId);
                return sendSuccess(res, updatedWallet, 'Funds added successfully', 201);
            })();
        } catch (error) {
            console.error('[Business Wallet Controller] Error adding money:', error);
            return sendError(res, 'Failed to add funds', 500);
        }
    },

    convertPoints: async (req, res) => {
        const { points, conversionRate } = req.body;
        if (!points || points <= 0) return sendError(res, 'Valid points amount is required', 400);

        try {
            const userId = req.user.id;
            const now = new Date().toISOString();

            return await db.transaction(async () => {
                const wallet = await db.prepare('SELECT * FROM business_wallets WHERE user_id = ?').get(userId);
                
                if (!wallet || wallet.reward_points < points) {
                    return sendError(res, 'Insufficient reward points', 400);
                }

                const creditAmount = points / (conversionRate || 100);

                // Update balance and points
                await db.prepare(
                    'UPDATE business_wallets SET balance = balance + ?, reward_points = reward_points - ?, updated_at = ? WHERE id = ?'
                ).run(creditAmount, points, now, wallet.id);

                // Add transaction
                await db.prepare(
                    'INSERT INTO business_wallet_transactions (wallet_id, type, amount, description, transaction_ref, created_at) VALUES (?, ?, ?, ?, ?, ?)'
                ).run(wallet.id, 'CREDIT', creditAmount, `Converted ${points} Reward Points`, `PTS-${Date.now()}`, now);

                const updatedWallet = await db.prepare('SELECT * FROM business_wallets WHERE user_id = ?').get(userId);
                return sendSuccess(res, updatedWallet, 'Points converted successfully', 201);
            })();
        } catch (error) {
            console.error('[Business Wallet Controller] Error converting points:', error);
            return sendError(res, 'Failed to convert points', 500);
        }
    }
};

module.exports = businessWalletController;
