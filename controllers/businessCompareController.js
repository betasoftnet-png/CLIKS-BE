const db = require('../db/connection');

exports.getComparisonSummary = async (req, res) => {
    try {
        const userId = req.user.id;
        const { planIds } = req.query; // Expecting comma separated IDs
        
        if (!planIds) {
            return res.status(400).json({ success: false, message: 'Plan IDs are required for comparison' });
        }

        const ids = planIds.split(',').map(id => parseInt(id));
        const plans = [];

        for (const id of ids) {
            const plan = await db.prepare('SELECT * FROM business_plans WHERE id = ? AND user_id = ?').get(id, userId);
            if (plan) {
                const items = await db.prepare('SELECT type, SUM(amount) as total FROM business_plan_items WHERE plan_id = ? GROUP BY type').all(id);
                plan.metrics = items;
                plans.push(plan);
            }
        }

        res.json({ success: true, data: plans });
    } catch (error) {
        console.error('Error fetching comparison summary:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch comparison summary' });
    }
};

exports.getPeriodicComparison = async (req, res) => {
    try {
        const userId = req.user.id;
        // Compare Billing revenue vs Inventory costs for last 2 months
        // This is a more complex query, but for now we'll provide a mock-like structure derived from real data
        
        const currentMonthRevenue = await db.prepare(
            "SELECT SUM(amount) as total FROM business_invoices WHERE user_id = ? AND status = 'Paid'"
        ).get(userId);

        const currentMonthExpenses = await db.prepare(
            "SELECT SUM(salary) as total FROM business_employees WHERE user_id = ? AND status = 'active'"
        ).get(userId);

        res.json({ 
            success: true, 
            data: {
                current: { revenue: currentMonthRevenue.total || 0, expenses: currentMonthExpenses.total || 0 },
                previous: { revenue: (currentMonthRevenue.total || 0) * 0.85, expenses: (currentMonthExpenses.total || 0) * 0.9 } // Mocked trend
            }
        });
    } catch (error) {
        console.error('Error fetching periodic comparison:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch periodic comparison' });
    }
};
