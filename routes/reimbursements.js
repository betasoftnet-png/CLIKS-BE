const express = require('express');
const router = express.Router();
const expensesController = require('../controllers/expensesController');

router.get('/', expensesController.getReimbursements);
router.post('/', expensesController.reimburseExpense);
router.post('/lodge', expensesController.reimburseExpense);

module.exports = router;
