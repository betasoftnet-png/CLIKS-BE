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
router.get('/clients/:id/documents', caController.getClientDocuments);
router.post('/clients/:id/upload-phase', caController.uploadClientPhaseDoc);
router.post('/clients/:id/documents/review', caController.updateClientDocumentReview);
router.get('/clients/:id/gst-credentials', caController.getClientGstCredentials);
router.get('/clients/:id/gst-status', caController.getClientGstStatus);
router.post('/clients/:id/request-gst-credentials', caController.requestClientGstCredentials);
router.post('/clients/:id/gst-audit', caController.logGstClientAction);
router.get('/owner/gst-credentials', caController.getOwnerGstCredentials);
router.post('/owner/gst-credentials', caController.saveOwnerGstCredentials);
router.delete('/owner/gst-credentials', caController.revokeOwnerGstCredentials);

router.get('/requests', caController.getRequests);
router.post('/requests', caController.addRequest);
router.post('/requests/:id/upload', caController.uploadRequestDoc);
router.post('/requests/:id/approve', caController.approveRequestDoc);

router.get('/tasks', caController.getTasks);
router.post('/tasks', caController.addTask);
router.put('/tasks/:id', caController.updateTask);
router.delete('/tasks/:id', caController.deleteTask);
router.post('/tasks/:id/toggle', caController.toggleTaskStatus);
router.post('/tasks/:id/upload', caController.uploadTaskDoc);

// Notifications & Presence Endpoints
router.get('/notifications', caController.getNotifications);
router.post('/notifications', caController.addNotification);
router.put('/notifications/read-all', caController.markAllNotificationsRead);
router.put('/notifications/:id/read', caController.markNotificationRead);

router.get('/presence', caController.getPresenceStatus);
router.post('/presence/login', caController.setUserOnline);
router.post('/presence/logout', caController.setUserOffline);
router.post('/presence/heartbeat', caController.updatePresenceHeartbeat);

// Direct Chat Endpoints
router.get('/messages/unread-count', caController.getUnreadChatCount);
router.get('/messages/:partnerId', caController.getChatMessages);
router.post('/messages', caController.sendChatMessage);

// GST Credentials Endpoints
router.get('/gst-credentials', caController.getGstCredentials);
router.post('/gst-credentials', caController.saveGstCredentials);
router.post('/gst-credentials/request', caController.requestGstCredentials);
router.put('/gst-credentials/revoke', caController.revokeGstCredentials);
router.delete('/gst-credentials', caController.revokeGstCredentials);

router.get('/documents/versions/:docId', caController.getDocumentVersions);
router.get('/tds/history', caController.getTdsHistory);
router.post('/tds/calculate', caController.saveTdsCalculation);
router.put('/tds/history/:id', caController.updateTdsCalculation);
router.delete('/tds/history/:id', caController.deleteTdsCalculation);

router.get('/timesheets', caController.getTimesheets);
router.post('/timesheets', caController.addTimesheet);

router.get('/documents/folders', caController.getFolders);
router.get('/documents/files', caController.getFiles);
router.post('/documents/files', caController.addFile);
router.delete('/documents/files/:id', caController.deleteFile);

// Teams & Team Requests System
router.get('/team-members', caController.getTeamMembers);
router.delete('/team-members/:id', caController.removeTeamMember);
router.get('/team-requests', caController.getTeamRequests);
router.post('/team-requests', caController.addTeamRequest);
router.post('/team-requests/:id/accept', caController.acceptTeamRequest);
router.post('/team-requests/:id/reject', caController.rejectTeamRequest);
router.delete('/team-requests/:id', caController.cancelTeamRequest);

// Billing & Audit Session Routes
router.post('/audit-sessions', caController.addAuditSession);
router.get('/audit-sessions', caController.getAuditSessions);
router.post('/invoices/generate', caController.generateProfessionalInvoice);
router.get('/invoices', caController.getProfessionalInvoices);
router.get('/invoices/:id/pdf', caController.getProfessionalInvoicePdf);
router.get('/earnings/dashboard', caController.getEarningsDashboard);
router.post('/invoices/:id/pay', caController.payInvoice);
router.get('/payment-history', caController.getPaymentHistory);

module.exports = router;

