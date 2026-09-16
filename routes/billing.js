const express = require('express');
const router = express.Router();
const billingController = require('../controllers/billingController');
const { auth, businessOnly, requireBusinessAccount } = require('../middleware/auth');

router.use(auth);
router.use(businessOnly);


// ── Reports & Global Operations (declared BEFORE parameterized routes) ────────
router.get('/reports/sales', billingController.getSalesReport);
router.get('/reports/gst', billingController.getGstReport);
router.get('/reports/payment', billingController.getPaymentReport);
router.get('/reports/outstanding', billingController.getOutstandingReport);

router.post('/import', billingController.importInvoices);
router.get('/export', billingController.exportInvoices);

router.get('/analytics', billingController.getAnalytics);
router.get('/dashboard-summary', billingController.getDashboardSummary);

// ── Invoices search ────────
router.get('/invoices/search', billingController.searchInvoices);

// ── Invoices CRUD (Both /billing and /billing/invoices endpoints) ────────
// POST /billing or /billing/invoices
router.post('/', billingController.createInvoice);
router.post('/invoices', billingController.createInvoice);

// GET /billing or /billing/invoices
router.get('/', billingController.getInvoices);
router.get('/invoices', billingController.getInvoices);

// GET /billing/:id or /billing/invoices/:id
router.get('/:id', billingController.getInvoiceById);
router.get('/invoices/:id', billingController.getInvoiceById);

// PUT /billing/:id or /billing/invoices/:id
router.put('/:id', billingController.updateInvoice);
router.patch('/:id', billingController.updateInvoice); // Support both PATCH and PUT
router.put('/invoices/:id', billingController.updateInvoice);

// DELETE /billing/:id or /billing/invoices/:id
router.delete('/:id', billingController.deleteInvoice);
router.delete('/invoices/:id', billingController.deleteInvoice);

// ── Nested Sub-routes for Payments, Returns, Notes, Documents, and Status ────────
router.patch('/:id/status', billingController.updateInvoiceStatus);
router.patch('/invoices/:id/status', billingController.updateInvoiceStatus);

router.post('/:id/payments', billingController.createInvoicePayment);
router.get('/:id/payments', billingController.getInvoicePayments);
router.post('/invoices/:id/payments', billingController.createInvoicePayment);
router.get('/invoices/:id/payments', billingController.getInvoicePayments);

router.post('/:id/returns', billingController.createInvoiceReturn);
router.get('/:id/returns', billingController.getInvoiceReturns);
router.post('/invoices/:id/returns', billingController.createInvoiceReturn);
router.get('/invoices/:id/returns', billingController.getInvoiceReturns);

router.post('/:id/notes', billingController.createInvoiceNote);
router.get('/:id/notes', billingController.getInvoiceNotes);
router.post('/invoices/:id/notes', billingController.createInvoiceNote);
router.get('/invoices/:id/notes', billingController.getInvoiceNotes);

router.post('/:id/documents', billingController.createInvoiceDocument);
router.get('/:id/documents', billingController.getInvoiceDocuments);
router.post('/invoices/:id/documents', billingController.createInvoiceDocument);
router.get('/invoices/:id/documents', billingController.getInvoiceDocuments);

// Actions: share, pdf, print, whatsapp, email, cancel, duplicate, einvoice, ewaybill
router.post('/:id/share', billingController.shareInvoice);
router.get('/:id/pdf', billingController.getInvoicePdf);
router.get('/:id/print', billingController.printInvoice);
router.post('/:id/send-whatsapp', billingController.sendWhatsapp);
router.post('/:id/send-email', billingController.sendEmail);
router.post('/:id/cancel', billingController.cancelInvoice);
router.post('/:id/duplicate', billingController.duplicateInvoice);
router.post('/:id/einvoice', billingController.einvoice);
router.post('/:id/ewaybill', billingController.ewaybill);

router.post('/invoices/:id/share', billingController.shareInvoice);
router.get('/invoices/:id/pdf', billingController.getInvoicePdf);
router.get('/invoices/:id/print', billingController.printInvoice);
router.post('/invoices/:id/send-whatsapp', billingController.sendWhatsapp);
router.post('/invoices/:id/send-email', billingController.sendEmail);
router.post('/invoices/:id/cancel', billingController.cancelInvoice);
router.post('/invoices/:id/duplicate', billingController.duplicateInvoice);
router.post('/invoices/:id/einvoice', billingController.einvoice);
router.post('/invoices/:id/ewaybill', billingController.ewaybill);

router.get('/:id/history', billingController.getInvoiceHistory);
router.get('/:id/timeline', billingController.getInvoiceHistory);
router.get('/invoices/:id/history', billingController.getInvoiceHistory);
router.get('/invoices/:id/timeline', billingController.getInvoiceHistory);

module.exports = router;
