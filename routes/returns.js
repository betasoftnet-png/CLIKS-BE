const express = require('express');
const router = express.Router();
const returnsController = require('../controllers/returnsController');
const { auth, businessOnly, requireBusinessAccount } = require('../middleware/auth');

router.use(auth);
router.use(businessOnly);


// ── Reports & Global Operations (declared BEFORE parameterized routes) ────────
router.get('/reports/summary', returnsController.getSummaryReport);
router.get('/reports/customer', returnsController.getCustomerReport);
router.get('/reports/products', returnsController.getProductsReport);
router.get('/reports/refunds', returnsController.getRefundsReport);
router.get('/reports/damaged-items', returnsController.getDamagedItemsReport);

router.post('/import', returnsController.importReturns);
router.get('/export', returnsController.exportReturns);

router.get('/analytics', returnsController.getAnalytics);
router.get('/dashboard-summary', returnsController.getDashboardSummary);

// ── Returns CRUD ────────
router.post('/', returnsController.createReturn);
router.get('/', returnsController.getReturns);

router.get('/search', returnsController.getReturns); // Mapping search parameter to getReturns

router.get('/:id', returnsController.getReturnById);
router.put('/:id', returnsController.updateReturn);
router.delete('/:id', returnsController.deleteReturn);

router.patch('/:id/status', returnsController.updateReturn);

// ── Actions ────────
router.post('/:id/approve', returnsController.approveReturn);
router.post('/:id/reject', returnsController.rejectReturn);

router.post('/:id/refund', returnsController.processRefund);
router.get('/:id/refunds', returnsController.getRefunds);

router.post('/:id/replacement', returnsController.processReplacement);
router.get('/:id/replacement', returnsController.getReplacement);

router.post('/:id/stock-adjustment', returnsController.getStockAdjustment);
router.get('/:id/stock-history', returnsController.getStockHistory);

router.post('/:id/share', returnsController.shareReturn);
router.get('/:id/pdf', returnsController.getReturnPdf);
router.get('/:id/print', returnsController.printReturn);

router.post('/:id/send-whatsapp', returnsController.sendWhatsapp);
router.post('/:id/send-email', returnsController.sendEmail);

router.get('/:id/history', returnsController.getTimeline);
router.get('/:id/timeline', returnsController.getTimeline);

// ── Notes & Documents ────────
router.post('/:id/notes', returnsController.createReturnNote);
router.get('/:id/notes', returnsController.getReturnNotes);

router.post('/:id/documents', returnsController.createReturnDocument);
router.get('/:id/documents', returnsController.getReturnDocuments);

module.exports = router;
