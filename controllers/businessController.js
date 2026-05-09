// const db = require('../db/connection');

exports.getBusinessStats = async (req, res) => {
    try {
        // Mock business stats for now, in a real app these would be calculated from business-specific tables
        const stats = {
            revenue: 452000,
            growth: 18,
            activeProjects: 24,
            newClients: 12
        };
        res.json({ success: true, data: stats });
    } catch (error) {
        console.error('Error fetching business stats:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch business stats' });
    }
};

exports.getRecentOperations = async (req, res) => {
    try {
        // Mock operations
        const operations = [
            { id: 1, title: 'Inventory Restock', time: '2h ago', status: 'Completed' },
            { id: 2, title: 'New Client Onboarding', time: '5h ago', status: 'Pending' },
            { id: 3, title: 'Payroll Processed', time: 'Yesterday', status: 'Completed' }
        ];
        res.json({ success: true, data: operations });
    } catch (error) {
        console.error('Error fetching operations:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch operations' });
    }
};
