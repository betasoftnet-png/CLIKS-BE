const db = require('../db/connection');

exports.getInventory = async (req, res) => {
    try {
        const userId = req.user.id;
        const items = await db.prepare('SELECT * FROM inventory WHERE user_id = ? ORDER BY created_at DESC').all(userId);
        res.json({ success: true, data: items });
    } catch (error) {
        console.error('Error fetching inventory:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch inventory' });
    }
};

exports.addInventoryItem = async (req, res) => {
    const { name, sku, category, quantity, price, supplier, status } = req.body;
    try {
        const userId = req.user.id;
        const now = new Date().toISOString();
        const result = await db.prepare(
            `INSERT INTO inventory (user_id, name, sku, category, quantity, price, supplier, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run([userId, name, sku, category, quantity || 0, price || 0, supplier, status || 'In Stock', now, now]);
        
        res.status(201).json({ 
            success: true, 
            data: { id: result.lastInsertRowid || result.id || result[0]?.id, name, sku, category, quantity, price, supplier, status } 
        });
    } catch (error) {
        console.error('Error adding inventory item:', error);
        res.status(500).json({ success: false, message: 'Failed to add inventory item' });
    }
};

exports.updateInventoryItem = async (req, res) => {
    const { id } = req.params;
    const { name, sku, category, quantity, price, supplier, status } = req.body;
    try {
        const userId = req.user.id;
        const now = new Date().toISOString();
        await db.prepare(
            `UPDATE inventory SET name = ?, sku = ?, category = ?, quantity = ?, price = ?, supplier = ?, status = ?, updated_at = ?
             WHERE id = ? AND user_id = ?`
        ).run([name, sku, category, quantity, price, supplier, status, now, id, userId]);
        
        res.json({ success: true, message: 'Inventory item updated successfully' });
    } catch (error) {
        console.error('Error updating inventory item:', error);
        res.status(500).json({ success: false, message: 'Failed to update inventory item' });
    }
};

exports.deleteInventoryItem = async (req, res) => {
    const { id } = req.params;
    try {
        const userId = req.user.id;
        await db.prepare('DELETE FROM inventory WHERE id = ? AND user_id = ?').run([id, userId]);
        res.json({ success: true, message: 'Inventory item deleted successfully' });
    } catch (error) {
        console.error('Error deleting inventory item:', error);
        res.status(500).json({ success: false, message: 'Failed to delete inventory item' });
    }
};

exports.adjustStock = async (req, res) => {
    const { id } = req.params;
    const { amount } = req.body; // Positive for Stock In, Negative for Stock Out
    try {
        const userId = req.user.id;
        const now = new Date().toISOString();
        
        // Use a transaction or careful update to prevent negative stock
        const item = await db.prepare('SELECT quantity FROM inventory WHERE id = ? AND user_id = ?').get([id, userId]);
        if (!item) return res.status(404).json({ success: false, message: 'Item not found' });
        
        const newQuantity = (item.quantity || 0) + parseInt(amount);
        if (newQuantity < 0) return res.status(400).json({ success: false, message: 'Insufficient stock for this operation' });
        
        const newStatus = newQuantity === 0 ? 'Out of Stock' : (newQuantity < 10 ? 'Low Stock' : 'In Stock');
        
        await db.prepare(
            'UPDATE inventory SET quantity = ?, status = ?, updated_at = ? WHERE id = ? AND user_id = ?'
        ).run([newQuantity, newStatus, now, id, userId]);
        
        res.json({ success: true, message: `Stock adjusted by ${amount}. New quantity: ${newQuantity}` });
    } catch (error) {
        console.error('Error adjusting stock:', error);
        res.status(500).json({ success: false, message: 'Failed to adjust stock' });
    }
};
