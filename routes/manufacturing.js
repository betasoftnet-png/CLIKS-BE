const express = require('express');
const router = express.Router();
const manufacturingController = require('../controllers/manufacturingController');
const { auth, businessOnly } = require('../middleware/auth');

router.use(auth);
router.use(businessOnly);

// ── Dashboard & Reports ───────────────────────────────────────────────────────
router.get('/dashboard', manufacturingController.getDashboardKPIs);
router.get('/reports', manufacturingController.getReports);
router.get('/reports/:reportType', manufacturingController.getReports);

// ── Production Orders Lifecycle ───────────────────────────────────────────────
router.get('/orders', manufacturingController.getOrders);
router.post('/orders', manufacturingController.createOrder);
router.get('/orders/:id', manufacturingController.getOrderById);
router.get('/orders/:id/availability', manufacturingController.checkAvailability);
router.post('/orders/:id/confirm', manufacturingController.confirmOrder);
router.post('/orders/:id/issue', manufacturingController.issueMaterials);
router.post('/orders/:id/consume', manufacturingController.recordConsumption);
router.post('/orders/:id/complete', manufacturingController.completeProduction);
router.post('/orders/:id/cancel', manufacturingController.cancelOrder);

// ── Legacy Routes (Backward Compatibility) ───────────────────────────────────
router.post('/start', (req, res) => {
    req.params.id = req.body.order_id || req.body.id;
    return manufacturingController.issueMaterials(req, res);
});
router.post('/complete', (req, res) => {
    req.params.id = req.body.order_id || req.body.id;
    return manufacturingController.completeProduction(req, res);
});

module.exports = router;
