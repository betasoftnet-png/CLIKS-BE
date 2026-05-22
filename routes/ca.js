const express = require('express');
const router = express.Router();
const caController = require('../controllers/caController');

router.post('/compliance-scan', caController.runComplianceScan);
router.get('/scans', caController.getScanHistory);
router.post('/cross-border-audit', caController.applyCrossBorderAudit);

// CA Connection/Invitation System
router.post('/invitations', caController.sendInvitation);
router.get('/invitations/outgoing', caController.getOutgoingInvitations);
router.get('/invitations/incoming', caController.getIncomingInvitations);
router.post('/invitations/:id/accept', caController.acceptInvitation);
router.delete('/invitations/:id', caController.revokeInvitation);

// Practice Workspace Management Endpoints
router.get('/clients', caController.getClients);
router.post('/clients', caController.addClient);

router.get('/requests', caController.getRequests);
router.post('/requests', caController.addRequest);
router.post('/requests/:id/upload', caController.uploadRequestDoc);
router.post('/requests/:id/approve', caController.approveRequestDoc);

router.get('/tasks', caController.getTasks);
router.post('/tasks', caController.addTask);
router.post('/tasks/:id/toggle', caController.toggleTaskStatus);
router.post('/tasks/:id/upload', caController.uploadTaskDoc);

router.get('/timesheets', caController.getTimesheets);
router.post('/timesheets', caController.addTimesheet);

router.get('/documents/folders', caController.getFolders);
router.get('/documents/files', caController.getFiles);
router.post('/documents/files', caController.addFile);
router.delete('/documents/files/:id', caController.deleteFile);

module.exports = router;

