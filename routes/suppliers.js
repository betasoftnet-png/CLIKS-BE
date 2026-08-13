const express = require('express');
const router = express.Router();
const supplierController = require('../controllers/supplierController');

// Reports (Define before /:id paths to avoid conflicts)
router.get('/reports/purchases',     supplierController.getPurchasesReport);
router.get('/reports/balance',       supplierController.getBalanceReport);
router.get('/reports/top-suppliers', supplierController.getTopSuppliersReport);
router.get('/reports/payment',       supplierController.getPaymentsReport);

// Bulk Import/Export
router.post('/import',               supplierController.importSuppliers);
router.get('/export',                supplierController.exportSuppliers);

// Website Supplier Portal Integrations
router.get('/portal/integrations',                 supplierController.getPortalIntegrations);
router.post('/portal/integrations/:id/respond',    supplierController.respondPortalIntegration);

// Search, Outstanding & Dashboard
router.get('/search',                supplierController.searchSuppliers);
router.get('/outstanding/list',      supplierController.getOutstandingList);
router.get('/dashboard-summary',     supplierController.getDashboardSummary);

// Base CRUD
router.post('/',                     supplierController.createSupplier);
router.get('/',                      supplierController.getSuppliers);
router.get('/:id',                   supplierController.getSupplierById);
router.put('/:id',                   supplierController.updateSupplier);
router.delete('/:id',                supplierController.deleteSupplier);

// Dealer <-> Supplier Chat
router.get('/:id/chats',             supplierController.getChats);
router.post('/:id/chats',            supplierController.sendChatMessage);

// Sub resources
router.get('/:id/ledger',            supplierController.getLedger);
router.get('/:id/outstanding',       supplierController.getOutstanding);

// Purchases, Payments & Returns
router.get('/:id/purchases',         supplierController.getPurchases);
router.get('/:id/payments',          supplierController.getPayments);
router.get('/:id/returns',           supplierController.getReturns);

// Posting payments
router.post('/:id/payments',         supplierController.createPayment);
router.get('/:id/payment-history',   supplierController.getPaymentHistory);

// Addresses
router.post('/:id/address',          supplierController.createAddress);
router.put('/:id/address/:addressId', supplierController.updateAddress);

// Contacts
router.post('/:id/contacts',         supplierController.createContact);
router.get('/:id/contacts',          supplierController.getContacts);
router.put('/:id/contacts/:contactId', supplierController.updateContact);
router.delete('/:id/contacts/:contactId', supplierController.deleteContact);

// Notes
router.post('/:id/notes',            supplierController.createNote);
router.get('/:id/notes',             supplierController.getNotes);

// Documents
router.post('/:id/documents',        supplierController.createDocument);
router.get('/:id/documents',         supplierController.getDocuments);

// Analytics
router.get('/:id/analytics',         supplierController.getAnalytics);

// History & Timeline
router.get('/:id/history',           supplierController.getHistory);
router.get('/:id/timeline',          supplierController.getTimeline);

// Actions
router.post('/:id/block',            supplierController.blockSupplier);
router.post('/:id/unblock',          supplierController.unblockSupplier);

module.exports = router;
