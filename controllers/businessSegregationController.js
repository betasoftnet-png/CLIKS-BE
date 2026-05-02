const db = require('../db/connection');

exports.getSegregations = async (req, res) => {
    try {
        const userId = req.user.id;
        const segregations = await db.prepare('SELECT * FROM segregation WHERE user_id = ? AND category = ? ORDER BY created_at DESC').all(userId, 'business');
        
        // Fetch allocations for each segregation
        for (let seg of segregations) {
            const allocations = await db.prepare('SELECT * FROM segregation_allocations WHERE rule_id = ?').all(seg.id);
            seg.allocations = allocations;
        }
        
        res.json({ success: true, data: segregations });
    } catch (error) {
        console.error('Error fetching business segregations:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch business segregations' });
    }
};

exports.createSegregation = async (req, res) => {
    const { name, description, rule_type, allocations } = req.body;
    try {
        const userId = req.user.id;
        const now = new Date().toISOString();
        
        // Use a simple transaction-like approach if needed, but for now direct execution
        const result = await db.prepare(
            `INSERT INTO segregation (user_id, name, description, rule_type, category, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run([userId, name, description, rule_type || 'percentage', 'business', now, now]);
        
        const ruleId = result.lastInsertRowid || result.id || result[0]?.id;

        if (allocations && Array.isArray(allocations)) {
            for (let alloc of allocations) {
                await db.prepare(
                    `INSERT INTO segregation_allocations (rule_id, user_id, label, percentage, notes, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`
                ).run([ruleId, userId, alloc.label, alloc.percentage, alloc.notes || '', now, now]);
            }
        }

        res.status(201).json({ success: true, data: { id: ruleId, name } });
    } catch (error) {
        console.error('Error creating business segregation:', error);
        res.status(500).json({ success: false, message: 'Failed to create business segregation' });
    }
};

exports.deleteSegregation = async (req, res) => {
    const { id } = req.params;
    try {
        const userId = req.user.id;
        await db.prepare('DELETE FROM segregation_allocations WHERE rule_id = ? AND user_id = ?').run([id, userId]);
        await db.prepare('DELETE FROM segregation WHERE id = ? AND user_id = ?').run([id, userId]);
        res.json({ success: true, message: 'Segregation deleted successfully' });
    } catch (error) {
        console.error('Error deleting business segregation:', error);
        res.status(500).json({ success: false, message: 'Failed to delete business segregation' });
    }
};
