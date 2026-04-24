const express = require('express');
const router = express.Router({ mergeParams: true });
const { verifyPlan, getPlanAnalysis } = require('../controllers/planAnalysisController');

// Middleware: verify the parent plan exists and belongs to the user
router.use(verifyPlan);

// GET /plans/:planId/analysis   — Get aggregated income, budget, and expense totals for a plan
router.get('/', getPlanAnalysis);

module.exports = router;
