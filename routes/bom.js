const express = require('express');
const router = express.Router();
const bomController = require('../controllers/bomController');
const { auth, businessOnly, requireBusinessAccount } = require('../middleware/auth');

router.use(auth);
router.use(businessOnly);


// Global Routes
router.get('/', bomController.getBoms);
router.post('/', bomController.createBom);
router.get('/search', bomController.getBoms);
router.get('/dashboard-summary', bomController.getDashboardSummary);
router.post('/import', bomController.importBoms);
router.get('/export', bomController.exportBoms);

// Reports
router.get('/reports/material-cost', bomController.getReportMaterialCost);
router.get('/reports/production-cost', bomController.getReportProductionCost);
router.get('/reports/material-usage', bomController.getReportMaterialUsage);
router.get('/reports/wastage', bomController.getReportWastage);
router.get('/reports/efficiency', bomController.getReportEfficiency);

// Specific ID Routes
router.get('/:id', bomController.getBomById);
router.put('/:id', bomController.updateBom);
router.delete('/:id', bomController.deleteBom);

// Sub-Resources
router.post('/:id/materials', bomController.addMaterial);
router.get('/:id/materials', bomController.getMaterials);
router.put('/:id/materials/:materialId', bomController.updateMaterial);
router.delete('/:id/materials/:materialId', bomController.deleteMaterial);

router.post('/:id/sub-bom', bomController.addSubBom);
router.get('/:id/sub-bom', bomController.getSubBoms);

router.post('/:id/process', bomController.addProcess);
router.get('/:id/process', bomController.getProcesses);

router.post('/:id/labor', bomController.addLabor);
router.get('/:id/labor', bomController.getLabor);

router.post('/:id/machines', bomController.addMachine);
router.get('/:id/machines', bomController.getMachines);

router.post('/:id/costing', bomController.addCosting);
router.get('/:id/costing', bomController.getCosting);

router.get('/:id/raw-materials', bomController.getRawMaterials);
router.get('/:id/finished-product', bomController.getFinishedProduct);
router.get('/:id/stock-availability', bomController.getStockAvailability);
router.get('/:id/material-shortage', bomController.getMaterialShortage);

router.post('/:id/version', bomController.addVersion);
router.get('/:id/versions', bomController.getVersions);

router.post('/:id/approve', bomController.approveBom);
router.post('/:id/reject', bomController.rejectBom);
router.post('/:id/duplicate', bomController.duplicateBom);

router.get('/:id/history', bomController.getHistory);
router.get('/:id/timeline', bomController.getTimeline);

router.post('/:id/documents', bomController.addDocument);
router.get('/:id/documents', bomController.getDocuments);

router.post('/:id/notes', bomController.addNote);
router.get('/:id/notes', bomController.getNotes);

router.get('/:id/analytics', bomController.getAnalytics);

router.post('/:id/block', bomController.blockBom);
router.post('/:id/unblock', bomController.unblockBom);

module.exports = router;
