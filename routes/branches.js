const express = require('express');
const router = express.Router();
const branchController = require('../controllers/branchController');

// Branch CRUD
router.get('/', branchController.getBranches);
router.post('/', branchController.createBranch);
router.get('/transfers', branchController.getTransfers);
router.post('/transfers', branchController.createTransfer);
router.post('/transfers/return-to-main', branchController.createReverseTransfer);
router.post('/stock/adjust', branchController.adjustBranchStock);

// Sales & Customer Modules: Promotions & Local Discounts
router.post('/promotions/request', branchController.requestShowroomPromotion);
router.get('/promotions', branchController.getShowroomPromotions);
router.put('/promotions/:id/status', branchController.updateShowroomPromotionStatus);
router.delete('/promotions/:id', branchController.deleteShowroomPromotion);

// Sales & Customer Modules: Cross-Branch Loyalty & Store Credit
router.get('/customers/cross-branch', branchController.getCrossBranchCustomers);
router.post('/customers/:id/store-credit', branchController.issueCrossBranchStoreCredit);
router.get('/customers/:id/history', branchController.getCustomerCrossBranchHistory);

router.get('/:id', branchController.getBranchById);
router.put('/:id', branchController.updateBranch);
router.delete('/:id', branchController.deleteBranch);
router.get('/:id/stock', branchController.getBranchStock);
router.get('/:id/low-stock', branchController.getBranchLowStock);
router.get('/:id/active-promotions', branchController.getActiveBranchPromotions);
router.post('/:id/auto-requisition', branchController.createAutoRequisition);

module.exports = router;
