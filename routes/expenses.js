const express = require('express');
const router = express.Router();
const expensesController = require('../controllers/expensesController');

// All endpoints inherit 'auth' and 'businessOnly' middleware from app.js
router.get('/', expensesController.getExpenses);
router.post('/', expensesController.createExpense);
router.get('/search', expensesController.getExpenses);

router.post('/categories', expensesController.createCategory);
router.get('/categories', expensesController.getCategories);
router.put('/categories/:id', expensesController.updateCategory);
router.delete('/categories/:id', expensesController.deleteCategory);

router.post('/recurring', expensesController.createRecurring);
router.get('/recurring', expensesController.getRecurrings);
router.put('/recurring/:id', expensesController.updateRecurring);
router.delete('/recurring/:id', expensesController.deleteRecurring);

router.post('/reimburse', expensesController.reimburseExpense);
router.get('/reimbursements', expensesController.getReimbursements);

// Budgets targets
router.post('/budgets', expensesController.createBudget);
router.get('/budgets', expensesController.getBudgets);
router.put('/budgets/:id', expensesController.updateBudget);
router.delete('/budgets/:id', expensesController.deleteBudget);

router.get('/reports/summary', expensesController.getReportSummary);
router.get('/reports/category', expensesController.getReportCategory);
router.get('/reports/monthly', expensesController.getReportMonthly);
router.get('/reports/vendor', expensesController.getReportVendor);
router.get('/reports/tax', expensesController.getReportTax);
router.get('/reports/reimbursement', expensesController.getReportReimbursement);

router.post('/import', expensesController.importExpenses);
router.get('/export', expensesController.exportExpenses);

router.get('/dashboard-summary', expensesController.getDashboardSummary);

router.get('/:id', expensesController.getExpense);
router.put('/:id', expensesController.updateExpense);
router.delete('/:id', expensesController.deleteExpense);

router.post('/:id/payments', expensesController.createPayment);
router.get('/:id/payments', expensesController.getPayments);

router.post('/:id/attachments', expensesController.addAttachment);
router.get('/:id/attachments', expensesController.getAttachments);
router.delete('/:id/attachments/:attachmentId', expensesController.deleteAttachment);

router.post('/:id/notes', expensesController.addNotes);
router.get('/:id/notes', expensesController.getNotes);

router.post('/:id/tags', expensesController.addTags);
router.get('/:id/tags', expensesController.getTags);

router.post('/:id/approve', expensesController.approveExpense);
router.post('/:id/reject', expensesController.rejectExpense);
router.post('/:id/pay', expensesController.payExpenseClaim);

router.post('/:id/reimburse', expensesController.reimburseExpense);
router.get('/:id/reimbursements', expensesController.getReimbursements);

router.post('/:id/tax', expensesController.addTax);
router.get('/:id/tax', expensesController.getTax);

router.post('/:id/vendor', expensesController.addVendor);
router.get('/:id/vendor', expensesController.getVendor);

router.get('/:id/history', expensesController.getHistory);
router.get('/:id/timeline', expensesController.getTimeline);

router.get('/:id/analytics', expensesController.getAnalytics);

router.post('/:id/block', expensesController.blockExpense);
router.post('/:id/unblock', expensesController.unblockExpense);

module.exports = router;
