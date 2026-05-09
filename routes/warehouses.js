const express = require('express');
const router = express.Router();
const warehouseController = require('../controllers/warehouseController');
const { auth } = require('../middleware/auth');

router.use(auth);

const businessOnly = (req, res, next) => {
    if (req.user && req.user.role === 'business') {
        next();
    } else {
        res.status(403).json({ success: false, message: 'Access denied. Business account required.' });
    }
};

router.use(businessOnly);

// Global Routes
router.get('/', warehouseController.getWarehouses);
router.post('/', warehouseController.createWarehouse);
router.get('/search', warehouseController.getWarehouses);
router.get('/reports', warehouseController.getReports);
router.get('/reports/stock', warehouseController.getWarehouseReportStock);
router.get('/reports/valuation', warehouseController.getWarehouseReportValuation);
router.get('/reports/movement', warehouseController.getWarehouseReportMovement);
router.get('/reports/capacity', warehouseController.getWarehouseReportCapacity);
router.get('/reports/damage', warehouseController.getWarehouseReportDamage);
router.get('/reports/expiry', warehouseController.getWarehouseReportExpiry);
router.post('/import', warehouseController.importWarehouses);
router.get('/export', warehouseController.exportWarehouses);
router.get('/dashboard-summary', warehouseController.getWarehouseDashboardSummary);

// Specific ID Routes
router.get('/:id', warehouseController.getWarehouseById);
router.put('/:id', warehouseController.updateWarehouse);
router.delete('/:id', warehouseController.deleteWarehouse);

// Stock & Products Mapping
router.post('/:id/stock', warehouseController.addStockToWarehouse);
router.get('/:id/stock', warehouseController.getStock);
router.post('/:id/products', warehouseController.addProductsToWarehouse);
router.get('/:id/products', warehouseController.getWarehouseProducts);

// Transfers & Logistics
router.post('/:id/transfers', warehouseController.transferStock);
router.get('/:id/transfers', warehouseController.getWarehouseTransfers);
router.post('/:id/inward', warehouseController.logWarehouseInward);
router.post('/:id/outward', warehouseController.logWarehouseOutward);
router.get('/:id/movements', warehouseController.getWarehouseMovements);
router.get('/:id/history', warehouseController.getWarehouseHistory);
router.get('/:id/timeline', warehouseController.getWarehouseTimeline);

// Staff Mapping
router.post('/:id/staff', warehouseController.addWarehouseStaff);
router.get('/:id/staff', warehouseController.getWarehouseStaff);

// Zones CRUD
router.post('/:id/zones', warehouseController.addWarehouseZone);
router.get('/:id/zones', warehouseController.getWarehouseZones);
router.put('/:id/zones/:zoneId', warehouseController.updateWarehouseZone);
router.delete('/:id/zones/:zoneId', warehouseController.deleteWarehouseZone);

// Racks CRUD
router.post('/:id/racks', warehouseController.addWarehouseRack);
router.get('/:id/racks', warehouseController.getWarehouseRacks);
router.put('/:id/racks/:rackId', warehouseController.updateWarehouseRack);
router.delete('/:id/racks/:rackId', warehouseController.deleteWarehouseRack);

// Bins CRUD
router.post('/:id/bins', warehouseController.addWarehouseBin);
router.get('/:id/bins', warehouseController.getWarehouseBins);
router.put('/:id/bins/:binId', warehouseController.updateWarehouseBin);
router.delete('/:id/bins/:binId', warehouseController.deleteWarehouseBin);

// Statistics, Valuation, Adjustments
router.get('/:id/valuation', warehouseController.getWarehouseValuation);
router.get('/:id/capacity', warehouseController.getWarehouseCapacity);
router.get('/:id/low-stock', warehouseController.getWarehouseLowStock);
router.get('/:id/out-of-stock', warehouseController.getWarehouseOutOfStock);
router.get('/:id/damaged-stock', warehouseController.getWarehouseDamagedStock);
router.get('/:id/expiry-stock', warehouseController.getWarehouseExpiryStock);
router.post('/:id/adjustment', warehouseController.addWarehouseAdjustment);
router.get('/:id/adjustments', warehouseController.getWarehouseAdjustments);

// Documents & Notes
router.post('/:id/documents', warehouseController.addWarehouseDocument);
router.get('/:id/documents', warehouseController.getWarehouseDocuments);
router.post('/:id/notes', warehouseController.addWarehouseNote);
router.get('/:id/notes', warehouseController.getWarehouseNotes);
router.get('/:id/analytics', warehouseController.getWarehouseAnalytics);

// Blocking Control
router.post('/:id/block', warehouseController.blockWarehouse);
router.post('/:id/unblock', warehouseController.unblockWarehouse);

module.exports = router;
