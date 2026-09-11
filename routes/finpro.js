const express = require('express');
const router = express.Router();
const finproController = require('../controllers/finproController');

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
