const express = require('express');
const router = express.Router();
const caController = require('../controllers/caController');

router.post('/compliance-scan', caController.runComplianceScan);
router.get('/scans', caController.getScanHistory);
router.post('/cross-border-audit', caController.applyCrossBorderAudit);

module.exports = router;
