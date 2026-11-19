const express = require('express');
const router = express.Router();
const expensesController = require('../controllers/expensesController');

router.get('/', expensesController.getReimbursements);
router.post('/', expensesController.reimburseExpense);
router.post('/lodge', expensesController.reimburseExpense);

router.post('/:id/approve', expensesController.approveExpense);
router.post('/:id/reject', expensesController.rejectExpense);
router.post('/:id/pay', expensesController.payExpenseClaim);

module.exports = router;

