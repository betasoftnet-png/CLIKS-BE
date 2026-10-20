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

router.get('/:id', branchController.getBranchById);
router.put('/:id', branchController.updateBranch);
router.delete('/:id', branchController.deleteBranch);
router.get('/:id/stock', branchController.getBranchStock);
router.get('/:id/low-stock', branchController.getBranchLowStock);
router.post('/:id/auto-requisition', branchController.createAutoRequisition);

module.exports = router;
