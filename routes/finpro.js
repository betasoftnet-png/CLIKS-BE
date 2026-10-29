const express = require('express');
const router = express.Router();
const finproController = require('../controllers/finproController');

const db = require('../db/connection');

// FIN-PRO Security Guard: Verifies ICAI credentials and active subscription in the database
const requireFinproAccess = async (req, res, next) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }

        const verification = await db.prepare("SELECT * FROM ca_verifications WHERE user_id = ? AND status = 'VERIFIED'").get(userId);
        if (!verification) {
            return res.status(403).json({
                success: false,
                code: 'ICAI_VERIFICATION_REQUIRED',
                message: 'Access Denied: FIN-PRO requires verified ICAI Chartered Accountant credentials approved by Administrator.'
            });
        }

        const subscription = await db.prepare("SELECT * FROM finpro_subscriptions WHERE user_id = ? AND status = 'ACTIVE'").get(userId);
        if (!subscription) {
            return res.status(403).json({
                success: false,
                code: 'FINPRO_SUBSCRIPTION_REQUIRED',
                message: 'Access Denied: Active FIN-PRO subscription required to access the Advisory Suite.'
            });
        }

        next();
    } catch (err) {
        console.error('FIN-PRO Security Guard Error:', err);
        return res.status(500).json({ success: false, message: 'Authorization check failed' });
    }
};

router.use(requireFinproAccess);

// 1. Overview & Analytics
router.get('/analytics/overview', finproController.getAnalyticsOverview);

// 2. Client Engagement Desk
router.get('/engagements', finproController.getEngagements);
router.post('/engagements', finproController.createEngagement);

// 3. Compliance Audit Checklist
router.get('/checklists', finproController.getChecklists);
router.patch('/checklists/:clauseId', finproController.updateChecklistClause);

// 4. Team Task Allocation
router.get('/tasks', finproController.getTasks);
router.patch('/tasks/:taskId/stage', finproController.updateTaskStage);
router.post('/tasks', finproController.createTask);

module.exports = router;
