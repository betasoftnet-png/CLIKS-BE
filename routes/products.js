const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');

// Reports (Define before /:id to avoid conflicts)
router.get('/reports/stock',        productController.getStockReport);
router.get('/reports/sales',        productController.getSalesReport);
router.get('/reports/profit',       productController.getProfitReport);
router.get('/reports/low-stock',    productController.getLowStockReport);
router.get('/reports/expiry',       productController.getExpiryReport);
router.get('/reports/top-products', productController.getTopProductsReport);

// Categories & Units
router.get('/categories',           productController.getCategories);
router.post('/categories',          productController.createCategory);
router.post('/:id/categories',      productController.createCategory);
router.put('/categories/:categoryId', productController.updateCategory);
router.delete('/categories/:categoryId', productController.deleteCategory);
router.get('/units',                productController.getUnits);

// Search, Import/Export & Dashboard
router.get('/search',                productController.searchProducts);
router.post('/import',               productController.importProducts);
router.get('/export',                productController.exportProducts);
router.get('/dashboard-summary',     productController.getDashboardSummary);

// Base CRUD
router.post('/',                     productController.createProduct);
router.get('/',                      productController.getProducts);
router.get('/:id',                   productController.getProductById);
router.put('/:id',                   productController.updateProduct);
router.delete('/:id',                productController.deleteProduct);

// Images & Documents
router.post('/:id/images',           productController.createImage);
router.get('/:id/images',            productController.getImages);
router.delete('/:id/images/:imageId', productController.deleteImage);
router.post('/:id/documents',        productController.createDocument);
router.get('/:id/documents',         productController.getDocuments);

// Barcodes, Serials & Batches
router.post('/:id/barcodes',         productController.createBarcode);
router.get('/:id/barcodes',          productController.getBarcode);
router.post('/:id/serial-numbers',   productController.createSerialNumber);
router.get('/:id/serial-numbers',    productController.getSerialNumber);
router.post('/:id/batches',          productController.createBatch);
router.get('/:id/batches',           productController.getBatches);

// Pricing
router.post('/:id/pricing',          productController.createPricing);
router.get('/:id/pricing',           productController.getPricing);
router.put('/:id/pricing',           productController.createPricing);

// Stock & History
router.get('/:id/stock',             productController.getStock);
router.get('/:id/stock-history',     productController.getStockHistory);

// Transactions
router.get('/:id/purchases',         productController.getPurchases);
router.get('/:id/sales',             productController.getSales);
router.get('/:id/returns',           productController.getReturns);

// Suppliers
router.get('/:id/suppliers',         productController.getSuppliers);

// Taxes
router.post('/:id/tax',              productController.createTax);
router.get('/:id/tax',               productController.getTax);

// Warehouse
router.post('/:id/warehouse',        productController.createWarehouse);
router.get('/:id/warehouse',         productController.getWarehouse);

// Notes
router.post('/:id/notes',            productController.createNote);
router.get('/:id/notes',             productController.getNotes);

// Analytics
router.get('/:id/analytics',         productController.getAnalytics);

// Actions
router.post('/:id/block',            productController.blockProduct);
router.post('/:id/unblock',          productController.unblockProduct);

// Timelines
router.get('/:id/history',           productController.getHistory);
router.get('/:id/timeline',          productController.getTimeline);

module.exports = router;
