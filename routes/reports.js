const express = require('express');
const router = express.Router();
const reportsController = require('../controllers/reportsController');

router.get('/dashboard-summary', reportsController.getDashboardSummary);

// Sales
router.get('/sales', reportsController.getSales);
router.get('/sales-summary', reportsController.getSalesSummary);
router.get('/sales-by-customer', reportsController.getSalesByCustomer);
router.get('/sales-by-product', reportsController.getSalesByProduct);
router.get('/sales-by-category', reportsController.getSalesByCategory);
router.get('/sales-by-salesperson', reportsController.getSalesBySalesperson);
router.get('/sales-return', reportsController.getSalesReturn);

// Purchases
router.get('/purchases', reportsController.getPurchases);
router.get('/purchase-summary', reportsController.getPurchaseSummary);
router.get('/purchases-by-supplier', reportsController.getPurchasesBySupplier);
router.get('/purchase-return', reportsController.getPurchaseReturn);

// Payments
router.get('/payments', reportsController.getPayments);
router.get('/payment-summary', reportsController.getPaymentSummary);
router.get('/payment-methods', reportsController.getPaymentMethods);
router.get('/payment-pending', reportsController.getPaymentPending);

// Expenses
router.get('/expenses', reportsController.getExpenses);
router.get('/expense-summary', reportsController.getExpenseSummary);
router.get('/expenses-by-category', reportsController.getExpensesByCategory);

// Financial Statements
router.get('/profit-loss', reportsController.getProfitLoss);
router.get('/balance-sheet', reportsController.getBalanceSheet);
router.get('/cash-flow', reportsController.getCashFlow);
router.get('/trial-balance', reportsController.getTrialBalance);
router.get('/general-ledger', reportsController.getGeneralLedger);
router.get('/day-book', reportsController.getDayBook);



// Stock
router.get('/stock', reportsController.getStock);
router.get('/stock-valuation', reportsController.getStockValuation);
router.get('/stock-movement', reportsController.getStockMovement);
router.get('/low-stock', reportsController.getLowStock);
router.get('/out-of-stock', reportsController.getOutOfStock);
router.get('/expiry-stock', reportsController.getExpiryStock);
router.get('/damaged-stock', reportsController.getDamagedStock);
router.get('/warehouse-stock', reportsController.getWarehouseStock);

// Products
router.get('/products/top-selling', reportsController.getTopSellingProducts);
router.get('/products/slow-moving', reportsController.getSlowMovingProducts);
router.get('/products/profitability', reportsController.getProductProfitability);

// Customers & Suppliers
router.get('/customers', reportsController.getCustomers);
router.get('/customers/outstanding', reportsController.getCustomersOutstanding);
router.get('/customers/top-customers', reportsController.getTopCustomers);
router.get('/suppliers', reportsController.getSuppliers);
router.get('/suppliers/outstanding', reportsController.getSuppliersOutstanding);
router.get('/top-suppliers', reportsController.getTopSuppliers);

// HR & Operations
router.get('/attendance', reportsController.getAttendance);
router.get('/payroll', reportsController.getPayroll);
router.get('/staff-performance', reportsController.getStaffPerformance);

// Manufacturing
router.get('/manufacturing', reportsController.getManufacturing);
router.get('/production-cost', reportsController.getProductionCost);
router.get('/material-consumption', reportsController.getMaterialConsumption);
router.get('/wastage', reportsController.getWastage);

// Utility & Exports
router.get('/date-range', reportsController.getDateRange);
router.get('/export/pdf', reportsController.exportPdf);
router.get('/export/excel', reportsController.exportExcel);
router.get('/export/csv', reportsController.exportCsv);

// Charts & Analytics
router.get('/charts/sales', reportsController.getChartSales);
router.get('/charts/purchases', reportsController.getChartPurchases);
router.get('/charts/profit', reportsController.getChartProfit);
router.get('/analytics', reportsController.getAnalytics);
router.get('/history', reportsController.getHistory);

module.exports = router;
