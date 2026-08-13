const express = require('express');
const router = express.Router();
const purchaseController = require('../controllers/purchaseController');

// Reports (Must define before GET /purchases/:id)
router.get('/reports/summary',      purchaseController.getSummaryReport);
router.get('/reports/supplier',     purchaseController.getSupplierReport);
router.get('/reports/gst',          purchaseController.getGstReport);
router.get('/reports/payment',      purchaseController.getPaymentReport);
router.get('/reports/pending',      purchaseController.getPendingReport);

// Search & Analytics
router.get('/search',               purchaseController.searchPurchases);
router.get('/analytics',            purchaseController.getAnalytics);
router.get('/dashboard-summary',    purchaseController.getDashboardSummary);

// Supplier Portal Routes
router.get('/portal/orders',                 purchaseController.getSupplierPortalOrders);
router.post('/:id/supplier-confirm',         purchaseController.confirmSupplierPurchase);

// Import / Export
router.post('/import',              purchaseController.importPurchases);
router.get('/export',               purchaseController.exportPurchases);

// CRUD
router.post('/',                    purchaseController.createPurchase);
router.get('/',                     purchaseController.getPurchases);
router.get('/:id',                  purchaseController.getPurchaseById);
router.put('/:id',                  purchaseController.updatePurchase);
router.delete('/:id',               purchaseController.deletePurchase);

// Items Management
router.post('/:id/items',           purchaseController.addPurchaseItem);
router.put('/:id/items/:itemId',    purchaseController.updatePurchaseItem);
router.delete('/:id/items/:itemId', purchaseController.deletePurchaseItem);

// Status Update
router.patch('/:id/status',         purchaseController.updatePurchaseStatus);

// Payments Management
router.post('/:id/payments',        purchaseController.processPurchasePayments);
router.get('/:id/payments',         purchaseController.getPurchasePayments);

// Returns Management
router.post('/:id/returns',         purchaseController.processPurchaseReturns);
router.get('/:id/returns',          purchaseController.getPurchaseReturns);

// Stock Adjustments
router.post('/:id/stock-update',    purchaseController.processStockUpdate);
router.post('/:id/receive-goods',   purchaseController.receiveGoods);
router.get('/:id/stock-history',    purchaseController.getStockHistory);

// Invoices & Bills
router.get('/:id/invoice',          purchaseController.getPurchaseInvoice);
router.get('/:id/bill',             purchaseController.getPurchaseBill);

// Sharing, PDF & Prints
router.post('/:id/share',           purchaseController.sharePurchase);
router.get('/:id/pdf',              purchaseController.getPurchasePdf);
router.get('/:id/print',            purchaseController.printPurchase);

// Messaging Channels
router.post('/:id/send-whatsapp',   purchaseController.sendWhatsapp);
router.post('/:id/send-email',      purchaseController.sendEmail);

// Cancel / Duplicate
router.post('/:id/cancel',          purchaseController.cancelPurchase);
router.post('/:id/duplicate',       purchaseController.duplicatePurchase);

// eWay Bill
router.post('/:id/ewaybill',        purchaseController.processEwaybill);

// History & Timeline
router.get('/:id/history',          purchaseController.getPurchaseHistory);
router.get('/:id/timeline',         purchaseController.getPurchaseTimeline);

// Notes Management
router.post('/:id/notes',           purchaseController.createPurchaseNote);
router.get('/:id/notes',            purchaseController.getPurchaseNotes);

// Documents Management
router.post('/:id/documents',       purchaseController.createPurchaseDocument);
router.get('/:id/documents',        purchaseController.getPurchaseDocuments);

module.exports = router;
