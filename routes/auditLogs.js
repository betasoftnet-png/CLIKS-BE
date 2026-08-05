const express = require('express');
const router = express.Router();
const auditLogController = require('../controllers/auditLogController');
const { authenticateToken } = require('../middleware/auth');

router.get('/', authenticateToken, auditLogController.getAuditLogs);

module.exports = router;
