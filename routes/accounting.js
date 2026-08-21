const express = require('express');
const router = express.Router();
const accountingController = require('../controllers/accountingController');

// All endpoints inherit 'auth' and 'businessOnly' middleware from app.js
router.post('/accounts', accountingController.createAccount);
router.get('/accounts', accountingController.getAccounts);
router.get('/accounts/search', accountingController.searchAccounts);
router.get('/accounts/:id', accountingController.getAccountById);
router.put('/accounts/:id', accountingController.updateAccount);
router.delete('/accounts/:id', accountingController.deleteAccount);

router.post('/journal-entries', accountingController.createJournalEntry);
router.get('/journal-entries', accountingController.getJournalEntries);
router.get('/journal-entries/:id', accountingController.getJournalEntryById);
router.put('/journal-entries/:id', accountingController.updateJournalEntry);
router.delete('/journal-entries/:id', accountingController.deleteJournalEntry);

router.post('/ledger', accountingController.createLedger);
router.get('/ledger', accountingController.getLedger);
router.get('/ledger/:id', accountingController.getLedgerById);

router.get('/trial-balance', accountingController.getTrialBalance);
router.get('/profit-loss', accountingController.getProfitLoss);
router.get('/balance-sheet', accountingController.getBalanceSheet);
router.get('/cash-flow', accountingController.getCashFlow);

router.post('/opening-balance', accountingController.createOpeningBalance);
router.get('/opening-balance', accountingController.getOpeningBalance);

router.post('/closing-balance', accountingController.createClosingBalance);
router.get('/closing-balance', accountingController.getClosingBalance);

router.post('/bank-accounts', accountingController.createBankAccount);
router.post('/accounts/:id/deposit', accountingController.recordDeposit);
router.post('/accounts/:id/withdraw', accountingController.recordWithdrawal);
router.post('/accounts/transfer', accountingController.recordTransfer);
router.get('/bank-accounts', accountingController.getBankAccounts);
router.put('/bank-accounts/:id', accountingController.updateBankAccount);
router.delete('/bank-accounts/:id', accountingController.deleteBankAccount);

router.post('/bank-reconciliation', accountingController.reconcileBank);
router.get('/bank-reconciliation', accountingController.getBankReconciliation);

router.post('/contra-entries', accountingController.createContraEntry);
router.get('/contra-entries', accountingController.getContraEntries);

router.post('/debit-notes', accountingController.createDebitNote);
router.get('/debit-notes', accountingController.getDebitNotes);

router.post('/credit-notes', accountingController.createCreditNote);
router.get('/credit-notes', accountingController.getCreditNotes);

router.post('/expenses', accountingController.createExpense);
router.get('/expenses', accountingController.getExpenses);

router.post('/income', accountingController.createIncome);
router.get('/income', accountingController.getIncome);

router.post('/fixed-assets', accountingController.createFixedAsset);
router.get('/fixed-assets', accountingController.getFixedAssets);

router.post('/depreciation', accountingController.createDepreciation);
router.get('/depreciation', accountingController.getDepreciation);

router.post('/tax', accountingController.createTax);
router.get('/tax', accountingController.getTax);

router.get('/history', accountingController.getHistory);
router.get('/timeline', accountingController.getHistory);

router.post('/notes', accountingController.addNote);
router.get('/notes', accountingController.getNotes);

router.post('/documents', accountingController.addDocuments);
router.get('/documents', accountingController.getDocuments);

router.get('/analytics', accountingController.getAnalytics);

router.get('/reports/general-ledger', accountingController.getReportGeneralLedger);
router.get('/reports/trial-balance', accountingController.getTrialBalance);
router.get('/reports/profit-loss', accountingController.getProfitLoss);
router.get('/reports/balance-sheet', accountingController.getBalanceSheet);
router.get('/reports/cash-flow', accountingController.getCashFlow);
router.get('/reports/day-book', accountingController.getReportDayBook);

router.post('/import', accountingController.importAccounting);
router.get('/export', accountingController.exportAccounting);

router.post('/lock-period', accountingController.lockPeriod);
router.post('/unlock-period', accountingController.unlockPeriod);

router.get('/dashboard-summary', accountingController.getDashboardSummary);

router.get('/test', (req, res) => {
    return res.status(200).json({
        success: true,
        message: 'successfully working',
        timestamp: new Date().toISOString()
    });
});

module.exports = router;
