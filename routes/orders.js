const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { auth, businessOnly, requireBusinessAccount } = require('../middleware/auth');

router.use(auth);
router.use(businessOnly);


// Reports & Static paths (Must be declared before parameter routes like /:id)
router.get('/search', orderController.searchOrders);
router.get('/reports/sales', orderController.getSalesReport);
router.get('/reports/status', orderController.getStatusReport);
router.get('/reports/pending', orderController.getPendingReport);
router.get('/reports/completed', orderController.getCompletedReport);
router.post('/import', orderController.importOrders);
router.get('/export', orderController.exportOrders);

// Base Orders CRUD
router.post('/', orderController.createOrder);
router.get('/', orderController.getOrders);
router.get('/:id', orderController.getOrderById);
router.put('/:id', orderController.updateOrder);
router.delete('/:id', orderController.deleteOrder);

// Nested Items & Actions
router.post('/:id/items', orderController.addOrderItem);
router.put('/:id/items/:itemId', orderController.updateOrderItem);
router.delete('/:id/items/:itemId', orderController.deleteOrderItem);

router.patch('/:id/status', orderController.updateOrderStatus);
router.post('/:id/convert-to-invoice', orderController.convertToInvoice);

router.post('/:id/notes', orderController.createOrderNote);
router.get('/:id/notes', orderController.getOrderNotes);

router.post('/:id/documents', orderController.createOrderDocument);
router.get('/:id/documents', orderController.getOrderDocuments);

router.get('/:id/analytics', orderController.getOrderAnalytics);

module.exports = router;
