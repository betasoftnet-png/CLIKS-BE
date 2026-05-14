const express = require('express');
const router = express.Router();
const { auth, allowRoles } = require('../middleware/auth');
const {
  salesAgentLogin,
  getAgentLeads,
  createLead,
  updateLead,
  getAgentStats
} = require('../controllers/salesAgentController');

// ── PUBLIC ROUTE: Representatitive Gate ───────────────────────────────
router.post('/login', salesAgentLogin);

// Apply structural authentication & restrict to sales agent role for everything below
router.use(auth);
router.use(allowRoles('sales_agent'));

// ── SECURED PROSPECTING MODULES ──────────────────────────────────────
router.get('/leads', getAgentLeads);
router.post('/leads', createLead);
router.patch('/leads/:id', updateLead);
router.get('/stats', getAgentStats);

module.exports = router;
