const express = require('express');
const router = express.Router();
const gstController = require('../controllers/gstController');

// All endpoints inherit 'auth' and 'businessOnly' middleware from app.js
router.get('/settings', gstController.getSettings);
router.post('/settings', gstController.updateSettings);
router.put('/settings', gstController.updateSettings);

router.post('/registrations', gstController.createRegistration);
router.get('/registrations', gstController.getRegistrations);
router.get('/registrations/:id', gstController.getRegistrationById);
router.put('/registrations/:id', gstController.updateRegistration);
router.delete('/registrations/:id', gstController.deleteRegistration);

router.post('/rates', gstController.createRate);
router.get('/rates', gstController.getRates);
router.put('/rates/:id', gstController.updateRate);
router.delete('/rates/:id', gstController.deleteRate);

router.post('/hsn-sac', gstController.createHsnSac);
router.get('/hsn-sac', gstController.getHsnSacs);
router.get('/hsn-sac/:id', gstController.getHsnSacById);
router.put('/hsn-sac/:id', gstController.updateHsnSac);
router.delete('/hsn-sac/:id', gstController.deleteHsnSac);

router.get('/invoices', gstController.getInvoices);
router.delete('/invoices/:id', gstController.deleteInvoice);
router.get('/purchases', gstController.getPurchases);
router.get('/returns', gstController.getReturns);

router.post('/einvoice', gstController.createEinvoice);
router.get('/einvoice/:id', gstController.getEinvoiceById);
router.post('/einvoice/cancel', gstController.cancelEinvoice);

router.post('/ewaybill', gstController.createEwayBill);
router.get('/ewaybill', gstController.getEwayBills);
router.get('/ewaybill/:id', gstController.getEwayBillById);
router.post('/ewaybill/cancel', gstController.cancelEwayBill);

router.get('/input-tax-credit', gstController.getInputTaxCredit);
router.get('/output-tax', gstController.getOutputTax);

router.get('/liability', gstController.getLiability);
router.get('/payment-summary', gstController.getPaymentSummary);

router.post('/payments', gstController.createPayment);
router.get('/payments', gstController.getPayments);

router.post('/refunds', gstController.createRefund);
router.get('/refunds', gstController.getRefunds);

router.get('/filings', gstController.getFilings);
router.post('/filings/gstr1', gstController.fileGstr1);
router.post('/filings/gstr2', gstController.fileGstr2);
router.post('/filings/gstr3b', gstController.fileGstr3b);
router.post('/filings/annual-return', gstController.fileAnnualReturn);

router.get('/filings/status', gstController.getFilingsStatus);
router.get('/filings/history', gstController.getFilingsHistory);

router.get('/reconciliation', gstController.getReconciliation);
router.post('/reconciliation/run', gstController.runReconciliation);

router.get('/late-fees', gstController.getLateFees);
router.get('/penalties', gstController.getPenalties);

router.get('/analytics', gstController.getAnalytics);

router.get('/reports/gstr1', gstController.getReportGstr1);
router.get('/reports/gstr2', gstController.getReportGstr2);
router.get('/reports/gstr3b', gstController.getReportGstr3b);
router.get('/reports/gstr9', gstController.getReportGstr9);
router.get('/reports/input-tax-credit', gstController.getReportITC);
router.get('/reports/output-tax', gstController.getReportOutputTax);
router.get('/reports/liability', gstController.getReportLiability);
router.get('/reports/hsn-summary', gstController.getReportHsnSummary);
router.get('/reports/filing-summary', gstController.getReportFilingSummary);

router.post('/import', gstController.importGst);
router.get('/export', gstController.exportGst);

router.post('/documents', gstController.addDocuments);
router.get('/documents', gstController.getDocuments);

router.get('/history', gstController.getHistory);
router.get('/timeline', gstController.getHistory);

router.get('/dashboard-summary', gstController.getDashboardSummary);

module.exports = router;
