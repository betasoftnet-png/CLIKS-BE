const express = require('express');
const router = express.Router();
const auditLogController = require('../controllers/auditLogController');
const { authenticateToken } = require('../middleware/auth');

router.get('/', authenticateToken, auditLogController.getAuditLogs);
router.post('/', authenticateToken, auditLogController.logActivity);

module.exports = router;
