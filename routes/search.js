const router = require('express').Router();
const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

router.get('/global', async (req, res) => {
    const { q } = req.query;
    if (!q) {
        return sendSuccess(res, [], 'Search query is empty');
    }

    try {
        const userId = req.user.id;
        const searchTerm = `%${q}%`;
        const results = [];

        // 1. Invoices
        try {
            const invoices = await db.prepare(`
                SELECT id, invoice_number, client_name, total_amount, status 
                FROM business_invoices 
                WHERE user_id = ? AND (invoice_number LIKE ? OR client_name LIKE ?)
                LIMIT 5
            `).all(userId, searchTerm, searchTerm);

            for (const inv of invoices) {
                results.push({
                    type: 'Invoice',
                    name: `${inv.invoice_number} - ${inv.client_name}`,
                    desc: `Amount: ₹${inv.total_amount} | Status: ${inv.status}`,
                    icon: 'FileText',
                    path: `/sales/invoice`,
                    rank: 6,
                    state: { highlightInvoiceId: inv.id, invoiceNumber: inv.invoice_number }
                });
            }
        } catch (e) {
            console.error('[Search API] Invoices search error:', e.message);
        }

        // 2. Customers
        try {
            const customers = await db.prepare(`
                SELECT id, name, company, email 
                FROM business_customers 
                WHERE user_id = ? AND (name LIKE ? OR company LIKE ? OR email LIKE ?)
                LIMIT 5
            `).all(userId, searchTerm, searchTerm, searchTerm);

            for (const cust of customers) {
                results.push({
                    type: 'Customer',
                    name: cust.name,
                    desc: cust.company ? `${cust.company} (${cust.email || ''})` : cust.email || 'No email',
                    icon: 'User',
                    path: `/sales/customers`,
                    rank: 4,
                    state: { highlightCustomerId: cust.id, customerName: cust.name }
                });
            }
        } catch (e) {
            console.error('[Search API] Customers search error:', e.message);
        }

        // 3. Products
        try {
            const products = await db.prepare(`
                SELECT id, name, sku, category, selling_price 
                FROM business_products 
                WHERE user_id = ? AND (name LIKE ? OR sku LIKE ? OR category LIKE ?)
                LIMIT 5
            `).all(userId, searchTerm, searchTerm, searchTerm);

            for (const prod of products) {
                results.push({
                    type: 'Product',
                    name: prod.name,
                    desc: `SKU: ${prod.sku || 'N/A'} | Price: ₹${prod.selling_price || 0}`,
                    icon: 'Package',
                    path: `/inventory/products`,
                    rank: 5,
                    state: { highlightProductId: prod.id, productName: prod.name }
                });
            }
        } catch (e) {
            console.error('[Search API] Products search error:', e.message);
        }

        // 4. Accounting Entries
        try {
            const accounting = await db.prepare(`
                SELECT id, entry_type, amount, category, mode, notes 
                FROM accounting 
                WHERE user_id = ? AND (category LIKE ? OR mode LIKE ? OR notes LIKE ?)
                LIMIT 5
            `).all(userId, searchTerm, searchTerm, searchTerm);

            for (const acc of accounting) {
                results.push({
                    type: 'Accounting',
                    name: `${acc.entry_type.toUpperCase()}: ${acc.category}`,
                    desc: `Amount: ₹${acc.amount} | Mode: ${acc.mode} ${acc.notes ? `(${acc.notes})` : ''}`,
                    icon: 'Calculator',
                    path: `/finance/accounting`,
                    rank: 7,
                    state: { highlightAccountId: acc.id }
                });
            }
        } catch (e) {
            console.error('[Search API] Accounting search error:', e.message);
        }

        // 5. Expense Entries
        try {
            const expenses = await db.prepare(`
                SELECT id, category, amount, description 
                FROM expenses 
                WHERE user_id = ? AND (category LIKE ? OR description LIKE ?)
                LIMIT 5
            `).all(userId, searchTerm, searchTerm);

            for (const exp of expenses) {
                results.push({
                    type: 'Expenses',
                    name: `Expense: ${exp.category}`,
                    desc: `Amount: ₹${exp.amount} ${exp.description ? `(${exp.description})` : ''}`,
                    icon: 'TrendingUp',
                    path: `/finance/expenses`,
                    rank: 7,
                    state: { highlightExpenseId: exp.id }
                });
            }
        } catch (e) {
            console.error('[Search API] Expenses search error:', e.message);
        }

        return sendSuccess(res, results, 'Global search results retrieved');
    } catch (err) {
        console.error('[Search API Error]:', err.message);
        return sendError(res, 'Global search failed', 500);
    }
});

module.exports = router;
