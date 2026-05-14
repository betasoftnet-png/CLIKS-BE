const express = require('express');
const router = express.Router();
const { auth, allowRoles } = require('../middleware/auth');
const { 
  getUsers, 
  deleteUser, 
  deletePublicPost, 
  updateUserRole,
  getSystemStats,
  impersonateUser,
  flushCache,
  runIntegrityCheck,
  getPublicPosts,
  getAuditLogs,
  getPlatformConfig,
  savePlatformConfig,
  getAnnouncements,
  createAnnouncement,
  toggleAnnouncement,
  deleteAnnouncement,
  getGlobalSalesData,
  getSalesAgents,
  createSalesAgent,
  toggleSalesAgentStatus,
  getGlobalLeads
} = require('../controllers/adminController');

// Apply auth and admin-only role checking to all routes within this file
router.use(auth);
router.use(allowRoles('admin'));

// GET    /admin/users              — List all registered users
router.get('/users', getUsers);

// DELETE /admin/users/:id          — Delete a user by ID
router.delete('/users/:id', deleteUser);

// POST   /admin/users/:id/impersonate — Impersonate client user
router.post('/users/:id/impersonate', impersonateUser);

// POST   /admin/system/flush-cache — Clear app cache
router.post('/system/flush-cache', flushCache);

// POST   /admin/system/integrity-check — Diagnostic DB audit
router.post('/system/integrity-check', runIntegrityCheck);

// DELETE /admin/public/:id         — Admin-delete a public post
router.delete('/public/:id', deletePublicPost);

// GET    /admin/public             — Get all public posts for moderation
router.get('/public', getPublicPosts);

// PATCH  /admin/users/:id/role     — Change a user's role (admin/user)
router.patch('/users/:id/role', updateUserRole);

// GET    /admin/stats              — Synthesise global system statistics
router.get('/stats', getSystemStats);

// GET    /admin/sales              — Stream aggregate platforms invoice telemetry
router.get('/sales', getGlobalSalesData);

// GET    /admin/logs               — Synthesise platform activity & audit logs
router.get('/logs', getAuditLogs);

// GET    /admin/config             — Retrieve platform overrides config
router.get('/config', getPlatformConfig);

// POST   /admin/config/save        — Update global dynamic config overrides
router.post('/config/save', savePlatformConfig);

// Announcement Endpoints
router.get('/announcements', getAnnouncements);
router.post('/announcements', createAnnouncement);
router.patch('/announcements/:id/toggle', toggleAnnouncement);
router.delete('/announcements/:id', deleteAnnouncement);

// Sales Representative Management
router.get('/sales/agents', getSalesAgents);
router.post('/sales/agents', createSalesAgent);
router.patch('/sales/agents/:id/toggle', toggleSalesAgentStatus);
router.get('/sales/leads', getGlobalLeads);

module.exports = router;


