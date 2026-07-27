const express = require('express');
const router = express.Router();
const gstController = require('../controllers/gstController');

router.get('/settings', gstController.getSettings);
router.get('/invoices', gstController.getInvoices);
router.post('/einvoice', gstController.generateInvoice);
router.get('/ewaybill', gstController.getEways);
router.post('/ewaybill', gstController.createEway);
router.get('/reconciliation', gstController.getReconciliations);
router.post('/reconciliation/run', gstController.runReconciliation);
router.delete('/invoices/:id', gstController.deleteInvoice);
router.get('/reports/gstr3b', gstController.getGSTR3B);
router.get('/reports/gstr9', gstController.getGSTR9);

module.exports = router;
