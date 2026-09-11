const express = require('express');
const router = express.Router();
const taxAuditController = require('../controllers/taxAuditController');

// 1. Sec 40A(3) Cash Payment Watchdog
router.get('/sec40a3', taxAuditController.getSec40a3Watchdog);
router.post('/sec40a3/exemption', taxAuditController.updateRule6ddExemption);

// 2. TDS/TCS Hub (Clause 34 of Form 3CD)
router.get('/clause34', taxAuditController.getClause34Hub);

// 3. Clause 44 Expense Breakdown Matrix
router.get('/clause44', taxAuditController.getClause44Breakdown);

// 4. Sec 43B(h) MSME Payment Tracker
router.get('/sec43bh', taxAuditController.getSec43bhTracker);

// 5. Statutory Dues Clock (PF/ESI)
router.get('/statutory-dues', taxAuditController.getStatutoryDuesClock);

module.exports = router;
