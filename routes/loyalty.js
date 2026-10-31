const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const {
  getProgramSettings,
  updateProgramSettings,
  getLoyaltyStats,
  getLoyaltyCustomers,
  adjustCustomerPoints,
  getLoyaltyTransactions
} = require('../controllers/loyaltyController');

// Program configuration & customization
router.get('/program-settings', auth, getProgramSettings);
router.get('/settings', auth, getProgramSettings);
router.patch('/program-settings', auth, updateProgramSettings);
router.patch('/settings', auth, updateProgramSettings);
router.put('/program-settings', auth, updateProgramSettings);
router.put('/settings', auth, updateProgramSettings);

// Statistics & Analytics
router.get('/stats', auth, getLoyaltyStats);

// Customer balances & tiers
router.get('/customers', auth, getLoyaltyCustomers);
router.post('/customers/:customerId/adjust', auth, adjustCustomerPoints);

// Transactions audit log
router.get('/transactions', auth, getLoyaltyTransactions);

module.exports = router;
