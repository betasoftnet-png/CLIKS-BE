const db = require('../db/connection');

exports.getPlans = async (req, res) => {
    try {
        const userId = req.user.id;
        const plans = await db.prepare('SELECT * FROM business_plans WHERE user_id = ? ORDER BY created_at DESC').all(userId);
        res.json({ success: true, data: plans });
    } catch (error) {
        console.error('Error fetching business plans:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch business plans' });
    }
};

exports.createPlan = async (req, res) => {
    const { name, description, start_date, end_date, total_budget, status } = req.body;
    try {
        const userId = req.user.id;
        const now = new Date().toISOString();
        const result = await db.prepare(
            `INSERT INTO business_plans (user_id, name, description, start_date, end_date, total_budget, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run([userId, name, description, start_date, end_date, total_budget || 0, status || 'Draft', now, now]);
        
        res.status(201).json({ 
            success: true, 
            data: { id: result.lastInsertRowid || result.id || result[0]?.id, name, total_budget, status } 
        });
    } catch (error) {
        console.error('Error creating business plan:', error);
        res.status(500).json({ success: false, message: 'Failed to create business plan' });
    }
};

exports.getPlanItems = async (req, res) => {
    const { id } = req.params;
    try {
        const items = await db.prepare('SELECT * FROM business_plan_items WHERE plan_id = ?').all(id);
        res.json({ success: true, data: items });
    } catch (error) {
        console.error('Error fetching plan items:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch plan items' });
    }
};

exports.addPlanItem = async (req, res) => {
    const { id } = req.params;
    const { type, category, description, amount, date } = req.body;
    try {
        const now = new Date().toISOString();
        await db.prepare(
            `INSERT INTO business_plan_items (plan_id, type, category, description, amount, date, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run([id, type, category, description, amount || 0, date || now, now]);
        
        res.status(201).json({ success: true, message: 'Item added to plan' });
    } catch (error) {
        console.error('Error adding plan item:', error);
        res.status(500).json({ success: false, message: 'Failed to add plan item' });
    }
};

exports.deletePlan = async (req, res) => {
    const { id } = req.params;
    try {
        const userId = req.user.id;
        await db.prepare('DELETE FROM business_plans WHERE id = ? AND user_id = ?').run([id, userId]);
        res.json({ success: true, message: 'Plan deleted successfully' });
    } catch (error) {
        console.error('Error deleting business plan:', error);
        res.status(500).json({ success: false, message: 'Failed to delete business plan' });
    }
};
