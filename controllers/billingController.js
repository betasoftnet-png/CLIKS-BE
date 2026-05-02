const db = require('../db/connection');

exports.getInvoices = async (req, res) => {
    try {
        const userId = req.user.id;
        const invoices = await db.prepare('SELECT * FROM business_invoices WHERE user_id = ? ORDER BY created_at DESC').all(userId);
        res.json({ success: true, data: invoices });
    } catch (error) {
        console.error('Error fetching invoices:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch invoices' });
    }
};

exports.createInvoice = async (req, res) => {
    const { invoice_number, client_name, client_email, amount, status, due_date, items } = req.body;
    try {
        const userId = req.user.id;
        const now = new Date().toISOString();
        const result = await db.prepare(
            `INSERT INTO business_invoices (user_id, invoice_number, client_name, client_email, amount, status, due_date, items, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run([userId, invoice_number, client_name, client_email, amount || 0, status || 'Draft', due_date, JSON.stringify(items || []), now, now]);
        
        res.status(201).json({ 
            success: true, 
            data: { id: result.lastInsertRowid || result.id || result[0]?.id, invoice_number, client_name, amount, status, due_date } 
        });
    } catch (error) {
        console.error('Error creating invoice:', error);
        res.status(500).json({ success: false, message: 'Failed to create invoice' });
    }
};

exports.updateInvoice = async (req, res) => {
    const { id } = req.params;
    const { client_name, client_email, amount, status, due_date, items } = req.body;
    try {
        const userId = req.user.id;
        const now = new Date().toISOString();
        await db.prepare(
            `UPDATE business_invoices SET client_name = ?, client_email = ?, amount = ?, status = ?, due_date = ?, items = ?, updated_at = ?
             WHERE id = ? AND user_id = ?`
        ).run([client_name, client_email, amount, status, due_date, JSON.stringify(items || []), now, id, userId]);
        
        res.json({ success: true, message: 'Invoice updated successfully' });
    } catch (error) {
        console.error('Error updating invoice:', error);
        res.status(500).json({ success: false, message: 'Failed to update invoice' });
    }
};

exports.deleteInvoice = async (req, res) => {
    const { id } = req.params;
    try {
        const userId = req.user.id;
        await db.prepare('DELETE FROM business_invoices WHERE id = ? AND user_id = ?').run([id, userId]);
        res.json({ success: true, message: 'Invoice deleted successfully' });
    } catch (error) {
        console.error('Error deleting invoice:', error);
        res.status(500).json({ success: false, message: 'Failed to delete invoice' });
    }
};
