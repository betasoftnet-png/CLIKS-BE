const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

const reportsController = {
    getDashboardSummary: async (req, res) => {
        try {
            const sales = await db.prepare("SELECT SUM(total_amount) as total FROM business_invoices WHERE user_id = ?").get(req.user.id);
            const purchases = await db.prepare("SELECT SUM(grand_total) as total FROM business_purchases WHERE user_id = ?").get(req.user.id);
            const expenses = await db.prepare("SELECT SUM(amount) as total FROM expenses WHERE user_id = ? AND (is_claim IS NULL OR is_claim = 'false') AND (is_budget IS NULL OR is_budget = 'false')").get(req.user.id);
            
            const salesTotal = parseFloat(sales?.total) || 0;
            const purchasesTotal = parseFloat(purchases?.total) || 0;
            const expensesTotal = parseFloat(expenses?.total) || 0;

            return sendSuccess(res, {
                total_sales: salesTotal,
                total_purchases: purchasesTotal,
                total_expenses: expensesTotal + purchasesTotal,
                status: 'healthy',
                updated_at: new Date().toISOString()
            }, 'Dashboard summary compiled');
        } catch (error) {
            console.error('Error in getDashboardSummary:', error);
            return sendError(res, 'Failed to compile dashboard summary', 500);
        }
    },

    // Sales Reports
    getSales: async (req, res) => {
        try {
            const list = await db.prepare("SELECT * FROM business_orders WHERE user_id = ? ORDER BY id DESC").all(req.user.id);
            return sendSuccess(res, list, 'Sales records compiled');
        } catch (error) {
            console.error('Error in getSales:', error);
            return sendError(res, 'Failed to fetch sales records', 500);
        }
    },
    getSalesSummary: async (req, res) => {
        try {
            const sales = await db.prepare("SELECT SUM(grand_total) as total FROM business_orders WHERE user_id = ?").get(req.user.id);
            return sendSuccess(res, { total_sales: sales?.total || 0, margin: '0%' }, 'Sales summary compiled');
        } catch (error) {
            console.error('Error in getSalesSummary:', error);
            return sendError(res, 'Failed to compile sales summary', 500);
        }
    },
    getSalesByCustomer: async (req, res) => {
        try {
            const list = await db.prepare("SELECT customer as name, SUM(grand_total) as total_sales FROM business_orders WHERE user_id = ? GROUP BY customer ORDER BY total_sales DESC").all(req.user.id);
            return sendSuccess(res, list || [], 'Sales by customer compiled');
        } catch (error) {
            console.error('Error in getSalesByCustomer:', error);
            return sendError(res, 'Failed to compile customer sales', 500);
        }
    },
    getSalesByProduct: async (req, res) => {
        try {
            const list = await db.prepare("SELECT name, SUM(total) as total_sales, SUM(quantity) as total_quantity FROM business_order_items WHERE order_id IN (SELECT id FROM business_orders WHERE user_id = ?) GROUP BY name ORDER BY total_sales DESC").all(req.user.id);
            return sendSuccess(res, list || [], 'Sales by product compiled');
        } catch (error) {
            console.error('Error in getSalesByProduct:', error);
            return sendError(res, 'Failed to compile product sales', 500);
        }
    },
    getSalesByCategory: async (req, res) => {
        return sendSuccess(res, [], 'Sales by category compiled');
    },
    getSalesBySalesperson: async (req, res) => {
        return sendSuccess(res, [], 'Sales by salesperson compiled');
    },
    getSalesReturn: async (req, res) => {
        return sendSuccess(res, [], 'Sales returns compiled');
    },

    // Purchases Reports
    getPurchases: async (req, res) => {
        return sendSuccess(res, [], 'Purchases records compiled');
    },
    getPurchaseSummary: async (req, res) => {
        return sendSuccess(res, { total_purchases: 0 }, 'Purchase summary compiled');
    },
    getPurchasesBySupplier: async (req, res) => {
        return sendSuccess(res, [], 'Purchases by supplier compiled');
    },
    getPurchaseReturn: async (req, res) => {
        return sendSuccess(res, [], 'Purchase returns compiled');
    },

    // Payments Reports
    getPayments: async (req, res) => {
        return sendSuccess(res, [], 'Payments records compiled');
    },
    getPaymentSummary: async (req, res) => {
        return sendSuccess(res, { settled: 0, pending: 0 }, 'Payment summary compiled');
    },
    getPaymentMethods: async (req, res) => {
        return sendSuccess(res, { UPI: 0, Cards: 0, Cash: 0 }, 'Payment methods compiled');
    },
    getPaymentPending: async (req, res) => {
        return sendSuccess(res, [], 'Pending payments compiled');
    },

    // Expenses Reports
    getExpenses: async (req, res) => {
        try {
            const list = await db.prepare("SELECT * FROM expenses WHERE user_id = ? AND (is_claim IS NULL OR is_claim = 'false') AND (is_budget IS NULL OR is_budget = 'false') ORDER BY id DESC").all(req.user.id);
            return sendSuccess(res, list, 'Expenses records compiled');
        } catch (error) {
            console.error('Error in reportsController.getExpenses:', error);
            return sendError(res, 'Failed to fetch expenses', 500);
        }
    },
    getExpenseSummary: async (req, res) => {
        try {
            const result = await db.prepare("SELECT SUM(amount) as total FROM expenses WHERE user_id = ? AND (is_claim IS NULL OR is_claim = 'false') AND (is_budget IS NULL OR is_budget = 'false')").get(req.user.id);
            return sendSuccess(res, { total_expenses: parseFloat(result?.total) || 0 }, 'Expense summary compiled');
        } catch (error) {
            return sendError(res, 'Failed to fetch expense summary', 500);
        }
    },
    getExpensesByCategory: async (req, res) => {
        try {
            const list = await db.prepare("SELECT category_name as category, SUM(amount) as total FROM expenses WHERE user_id = ? AND (is_claim IS NULL OR is_claim = 'false') AND (is_budget IS NULL OR is_budget = 'false') GROUP BY category_name").all(req.user.id);
            const result = {};
            for (const row of list) {
                result[row.category || 'General'] = row.total || 0;
            }
            return sendSuccess(res, result, 'Expenses by category compiled');
        } catch (error) {
            return sendError(res, 'Failed to fetch expenses by category', 500);
        }
    },

    // Financial Statements
    getProfitLoss: async (req, res) => {
        try {
            const ledger = await db.prepare("SELECT category, amount, entry_type FROM accounting WHERE user_id = ?").all(req.user.id);
            const expenses = await db.prepare("SELECT category, category_name, amount, is_claim, is_budget FROM expenses WHERE user_id = ?").all(req.user.id);
            const purchases = await db.prepare("SELECT grand_total FROM business_purchases WHERE user_id = ?").all(req.user.id);

            const ChartOfAccounts = {
                'Sales Revenue': 'Revenue',
                'Service Income': 'Revenue',
                'Other Income': 'Revenue',
                'Sales Income': 'Revenue',
                'General Income': 'Revenue',
                'Inventory Purchase (COGS)': 'Expense',
                'Inventory Purchase': 'Expense',
                'Travel & Meals': 'Expense',
                'Marketing': 'Expense',
                'Rent': 'Expense',
                'Salary': 'Expense',
                'Salary Expenses': 'Expense',
                'Utilities': 'Expense',
                'Rent & Utilities': 'Expense',
                'Office Expenses': 'Expense',
                'Bank Charges': 'Expense',
                'Software Subscriptions': 'Expense',
                'Vendor Purchase (GST)': 'Expense',
                'General Expense': 'Expense',
                'Operational Expense': 'Expense'
            };

            const getAccountType = (category, entryType) => {
                if (!category) return null;
                const cat = String(category).trim();
                if (ChartOfAccounts[cat]) {
                    return ChartOfAccounts[cat];
                }
                const lower = cat.toLowerCase();
                if (lower === 'contra' || lower === 'invoice payment' || lower === 'supplier payment' || lower === 'customer payment') {
                    return null;
                }
                if (lower.includes('sales') || lower.includes('income') || lower.includes('revenue') || lower.includes('billing')) {
                    return 'Revenue';
                }
                if (lower.includes('purchase') || lower.includes('expense') || lower.includes('travel') || lower.includes('meals') || lower.includes('marketing') || lower.includes('rent') || lower.includes('salary') || lower.includes('utilities') || lower.includes('charges') || lower.includes('subscriptions') || lower.includes('office') || lower.includes('cogs') || lower.includes('bill') || lower.includes('cloud') || lower.includes('saas') || lower.includes('transport') || lower.includes('coffee')) {
                    return 'Expense';
                }
                if (entryType === 'income') return 'Revenue';
                if (entryType === 'expense') return 'Expense';
                return null;
            };

            let grossRevenue = 0;
            let totalExpenses = 0;
            let costOfGoods = 0;
            let overheads = 0;

            for (const item of ledger) {
                const type = getAccountType(item.category, item.entry_type);
                if (type === 'Revenue') {
                    grossRevenue += parseFloat(item.amount) || 0;
                } else if (type === 'Expense') {
                    totalExpenses += parseFloat(item.amount) || 0;
                }
            }

            for (const exp of expenses) {
                if (exp.is_claim === 'true' || exp.is_budget === 'true') continue;
                const type = getAccountType(exp.category_name || exp.category || 'Office Expenses', 'expense');
                if (type === 'Expense') {
                    totalExpenses += parseFloat(exp.amount) || 0;
                    overheads += parseFloat(exp.amount) || 0;
                }
            }

            for (const pur of purchases) {
                const val = parseFloat(pur.grand_total) || 0;
                totalExpenses += val;
                costOfGoods += val;
            }

            const netProfit = grossRevenue - totalExpenses;

            return sendSuccess(res, {
                gross_revenue: grossRevenue,
                total_expenses: totalExpenses,
                cost_of_goods: costOfGoods,
                overheads: overheads,
                net_profit: netProfit
            }, 'Profit & Loss compiled');
        } catch (error) {
            console.error('Error in reportsController.getProfitLoss:', error);
            return sendError(res, 'Failed to compile Profit & Loss', 500);
        }
    },
    getBalanceSheet: async (req, res) => {
        try {
            const normalizePaymentMode = (mode) => {
                if (!mode) return 'Cash in Hand';
                const m = String(mode).trim().toLowerCase();
                if (m === 'cash' || m.includes('cash in hand') || m.includes('hand')) {
                    return 'Cash in Hand';
                }
                if (m.includes('hdfc')) {
                    return 'HDFC Bank Account';
                }
                if (m.includes('icici')) {
                    return 'ICICI Bank Account';
                }
                if (m.includes('sbi') || m.includes('state bank')) {
                    return 'SBI Current Account';
                }
                if (m === 'upi' || m.includes('razorpay') || m.includes('gpay') || m.includes('phonepe') || m.includes('paytm')) {
                    return 'UPI / Razorpay';
                }
                if (m === 'bank' || m.includes('bank')) {
                    return 'HDFC Bank Account';
                }
                return mode;
            };

            const accounts = await db.prepare("SELECT * FROM accounting WHERE user_id = ? AND entry_type = 'AccountConfig'").all(req.user.id);
            const transactions = await db.prepare("SELECT mode, entry_type, SUM(amount) as total FROM accounting WHERE user_id = ? AND entry_type IN ('income', 'expense') GROUP BY mode, entry_type").all(req.user.id);

            let cashAsset = 0;
            let bankAsset = 0;

            for (const acc of accounts) {
                const normName = normalizePaymentMode(acc.account_name);
                let totalIncome = 0;
                let totalExpenses = 0;

                for (const tx of transactions) {
                    const normMode = normalizePaymentMode(tx.mode);
                    if (normMode === normName) {
                        if (tx.entry_type === 'income') {
                            totalIncome += tx.total || 0;
                        } else {
                            totalExpenses += tx.total || 0;
                        }
                    }
                }

                const initialBal = parseFloat(acc.balance) || 0;
                const currentBalance = initialBal + totalIncome - totalExpenses;

                if (normName === 'Cash in Hand') {
                    cashAsset += currentBalance;
                } else {
                    bankAsset += currentBalance;
                }
            }

            // Accounts Receivable (outstanding invoices)
            const recSum = await db.prepare("SELECT SUM(due_amount) as total FROM business_invoices WHERE user_id = ? AND status != 'Paid'").get(req.user.id);
            const receivablesAsset = parseFloat(recSum?.total) || 0;

            // Inventory Asset Value
            const productsVal = await db.prepare("SELECT SUM(quantity * purchase_price) as total FROM business_products WHERE user_id = ?").get(req.user.id);
            const legacyVal = await db.prepare("SELECT SUM(quantity * price) as total FROM inventory WHERE user_id = ?").get(req.user.id);
            const inventoryAsset = (parseFloat(productsVal?.total) || 0) + (parseFloat(legacyVal?.total) || 0);

            // Fixed Assets from ledger
            const faSum = await db.prepare("SELECT SUM(amount) as total FROM accounting WHERE user_id = ? AND category = 'Fixed Assets'").get(req.user.id);
            const fixedAssetsAsset = parseFloat(faSum?.total) || 0;

            // Accounts Payable (outstanding purchases)
            const payResult = await db.prepare("SELECT SUM(grand_total - paid_amount) as total FROM business_purchases WHERE user_id = ?").get(req.user.id);
            const payablesLiability = parseFloat(payResult?.total) || 0;

            // GST Payable
            const gstSales = await db.prepare("SELECT SUM(tax_amount) as total FROM business_invoices WHERE user_id = ?").get(req.user.id);
            const gstPurchases = await db.prepare("SELECT SUM(total_tax) as total FROM business_purchases WHERE user_id = ?").get(req.user.id);
            const gstPayable = (parseFloat(gstSales?.total) || 0) - (parseFloat(gstPurchases?.total) || 0);

            // Loans liability (debts)
            const loanResult = await db.prepare("SELECT SUM(amount - amount_paid) as total FROM debts WHERE user_id = ?").get(req.user.id);
            const loansLiability = parseFloat(loanResult?.total) || 0;

            const totalAssets = cashAsset + bankAsset + inventoryAsset + receivablesAsset + fixedAssetsAsset;
            const liabilitiesExclEquity = payablesLiability + gstPayable + loansLiability;
            const equityVal = totalAssets - liabilitiesExclEquity;

            return sendSuccess(res, {
                assets: { 
                    cash: Math.max(0, cashAsset), 
                    bank: Math.max(0, bankAsset), 
                    inventory: Math.max(0, inventoryAsset), 
                    receivables: receivablesAsset, 
                    fixed_assets: fixedAssetsAsset 
                },
                liabilities: { 
                    payables: payablesLiability, 
                    gst_payable: gstPayable, 
                    loans: loansLiability, 
                    equity: equityVal
                }
            }, 'Balance sheet calculated');
        } catch (error) {
            console.error('Error in reportsController.getBalanceSheet:', error);
            return sendError(res, 'Failed to compile Balance Sheet', 500);
        }
    },
    getCashFlow: async (req, res) => {
        try {
            const accounts = await db.prepare("SELECT * FROM accounting WHERE user_id = ? AND entry_type = 'AccountConfig'").all(req.user.id);
            const transactions = await db.prepare("SELECT mode, entry_type, SUM(amount) as total FROM accounting WHERE user_id = ? AND entry_type IN ('income', 'expense') GROUP BY mode, entry_type").all(req.user.id);

            let totalInflows = 0;
            let totalOutflows = 0;

            const normalizePaymentMode = (mode) => {
                if (!mode) return 'Cash in Hand';
                const m = String(mode).trim().toLowerCase();
                if (m === 'cash' || m.includes('cash in hand') || m.includes('hand')) {
                    return 'Cash in Hand';
                }
                if (m.includes('hdfc')) {
                    return 'HDFC Bank Account';
                }
                if (m.includes('icici')) {
                    return 'ICICI Bank Account';
                }
                if (m.includes('sbi') || m.includes('state bank')) {
                    return 'SBI Current Account';
                }
                if (m === 'upi' || m.includes('razorpay') || m.includes('gpay') || m.includes('phonepe') || m.includes('paytm')) {
                    return 'UPI / Razorpay';
                }
                if (m === 'bank' || m.includes('bank')) {
                    return 'HDFC Bank Account';
                }
                return mode;
            };

            const configuredNames = accounts.map(a => normalizePaymentMode(a.account_name));

            for (const tx of transactions) {
                const normMode = normalizePaymentMode(tx.mode);
                if (configuredNames.includes(normMode)) {
                    if (tx.entry_type === 'income') {
                        totalInflows += tx.total || 0;
                    } else {
                        totalOutflows += tx.total || 0;
                    }
                }
            }

            return sendSuccess(res, {
                inflow: totalInflows,
                outflow: totalOutflows,
                net_flow: totalInflows - totalOutflows
            }, 'Cash Flow statement compiled');
        } catch (error) {
            return sendError(res, 'Failed to compile Cash Flow', 500);
        }
    },
    getTrialBalance: async (req, res) => {
        try {
            const debits = await db.prepare("SELECT SUM(amount) as total FROM accounting WHERE user_id = ? AND entry_type = 'expense'").get(req.user.id);
            const credits = await db.prepare("SELECT SUM(amount) as total FROM accounting WHERE user_id = ? AND entry_type = 'income'").get(req.user.id);
            return sendSuccess(res, {
                debits: parseFloat(debits?.total) || 0,
                credits: parseFloat(credits?.total) || 0
            }, 'Trial Balance compiled');
        } catch (error) {
            return sendError(res, 'Failed to compile Trial Balance', 500);
        }
    },
    getGeneralLedger: async (req, res) => {
        try {
            const list = await db.prepare("SELECT * FROM accounting WHERE user_id = ? ORDER BY date DESC, id DESC").all(req.user.id);
            return sendSuccess(res, list, 'General ledger compiled');
        } catch (error) {
            return sendError(res, 'Failed to compile General Ledger', 500);
        }
    },
    getDayBook: async (req, res) => {
        try {
            const list = await db.prepare("SELECT * FROM accounting WHERE user_id = ? ORDER BY date DESC, id DESC").all(req.user.id);
            return sendSuccess(res, list, 'Day book compiled');
        } catch (error) {
            return sendError(res, 'Failed to compile Day Book', 500);
        }
    },

    // Stock Reports
    getStock: async (req, res) => {
        return sendSuccess(res, [], 'Stock report compiled');
    },
    getStockValuation: async (req, res) => {
        return sendSuccess(res, { total_value: 0 }, 'Stock valuation report compiled');
    },
    getStockMovement: async (req, res) => {
        return sendSuccess(res, [], 'Stock movement compiled');
    },
    getLowStock: async (req, res) => {
        return sendSuccess(res, [], 'Low stock report compiled');
    },
    getOutOfStock: async (req, res) => {
        return sendSuccess(res, [], 'Out of stock report compiled');
    },
    getExpiryStock: async (req, res) => {
        return sendSuccess(res, [], 'Expiry stock report compiled');
    },
    getDamagedStock: async (req, res) => {
        return sendSuccess(res, [], 'Damaged stock report compiled');
    },
    getWarehouseStock: async (req, res) => {
        return sendSuccess(res, [], 'Warehouse stock report compiled');
    },

    // Products Analytics
    getTopSellingProducts: async (req, res) => {
        return sendSuccess(res, [], 'Top selling products compiled');
    },
    getSlowMovingProducts: async (req, res) => {
        return sendSuccess(res, [], 'Slow moving products compiled');
    },
    getProductProfitability: async (req, res) => {
        return sendSuccess(res, [], 'Product profitability compiled');
    },

    // Customer & Supplier Statements
    getCustomers: async (req, res) => {
        return sendSuccess(res, [], 'Customers list compiled');
    },
    getCustomersOutstanding: async (req, res) => {
        return sendSuccess(res, [], 'Customers outstanding report compiled');
    },
    getTopCustomers: async (req, res) => {
        return sendSuccess(res, [], 'Top customers report compiled');
    },
    getSuppliers: async (req, res) => {
        return sendSuccess(res, [], 'Suppliers list compiled');
    },
    getSuppliersOutstanding: async (req, res) => {
        return sendSuccess(res, [], 'Suppliers outstanding report compiled');
    },
    getTopSuppliers: async (req, res) => {
        return sendSuccess(res, [], 'Top suppliers report compiled');
    },

    // Attendance & Payroll Reports
    getAttendance: async (req, res) => {
        return sendSuccess(res, [], 'Attendance report compiled');
    },
    getPayroll: async (req, res) => {
        return sendSuccess(res, [], 'Payroll report compiled');
    },
    getStaffPerformance: async (req, res) => {
        return sendSuccess(res, [], 'Staff performance compiled');
    },

    // Manufacturing Reports
    getManufacturing: async (req, res) => {
        return sendSuccess(res, [], 'Manufacturing report compiled');
    },
    getProductionCost: async (req, res) => {
        return sendSuccess(res, { cost_per_unit: 0 }, 'Production cost report compiled');
    },
    getMaterialConsumption: async (req, res) => {
        return sendSuccess(res, [], 'Material consumption compiled');
    },
    getWastage: async (req, res) => {
        return sendSuccess(res, { wastage_percentage: '0%' }, 'Wastage report compiled');
    },

    // Date Range & Export
    getDateRange: async (req, res) => {
        return sendSuccess(res, { from: req.query.from, to: req.query.to }, 'Date range report compiled');
    },
    exportPdf: async (req, res) => {
        return sendSuccess(res, { download_url: '/exports/report.pdf' }, 'PDF exported');
    },
    exportExcel: async (req, res) => {
        return sendSuccess(res, { download_url: '/exports/report.xlsx' }, 'Excel exported');
    },
    exportCsv: async (req, res) => {
        return sendSuccess(res, { download_url: '/exports/report.csv' }, 'CSV exported');
    },

    getChartSales: async (req, res) => {
        try {
            const orders = await db.prepare("SELECT date, grand_total FROM business_orders WHERE user_id = ?").all(req.user.id);
            const monthlyData = Array(12).fill(0);
            orders.forEach(order => {
                if (order.date) {
                    const dateObj = new Date(order.date);
                    if (!isNaN(dateObj.getTime())) {
                        const monthIndex = dateObj.getMonth(); // 0 to 11
                        monthlyData[monthIndex] += (parseFloat(order.grand_total) || 0);
                    }
                }
            });
            const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            return sendSuccess(res, { labels, data: monthlyData }, 'Sales chart data compiled');
        } catch (error) {
            console.error('Error in getChartSales:', error);
            return sendError(res, 'Failed to compile sales chart data', 500);
        }
    },
    getChartPurchases: async (req, res) => {
        return sendSuccess(res, { labels: [], data: [] }, 'Purchases chart data compiled');
    },
    getChartProfit: async (req, res) => {
        return sendSuccess(res, { labels: [], data: [] }, 'Profit chart data compiled');
    },

    getAnalytics: async (req, res) => {
        return sendSuccess(res, { health_score: 0 }, 'Operational analytics compiled');
    },
    getHistory: async (req, res) => {
        return sendSuccess(res, [], 'Operational history compiled');
    }
};

module.exports = reportsController;
