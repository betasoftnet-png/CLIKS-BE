const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

/**
 * Helper to record audit logs
 */
async function recordAudit(action, details, performedBy, level = 'INFO') {
  try {
    const now = new Date().toISOString();
    await db.prepare(`
      INSERT INTO audit_logs (action_type, details, performed_by, severity, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run([action, details, performedBy, level, now]);
  } catch (err) {
    console.error('Failed to log platform audit:', err);
  }
}

// ── 1. SUPPORT AGENT PORTAL AUTHENTICATION ─────────────────────────────
const supportAgentLogin = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return sendError(res, 'Email and password coordinates required.', 400);
  }

  try {
    const agent = await db.prepare('SELECT * FROM support_agents WHERE email = ?').get(email);
    if (!agent) {
      return sendError(res, 'Access Violation: Invalid credentials.', 401);
    }

    if (agent.is_active === 0) {
      return sendError(res, 'Clearance Restricted: Account is deactivated.', 403);
    }

    const isMatch = await bcrypt.compare(password, agent.password_hash);
    if (!isMatch) {
      return sendError(res, 'Access Violation: Verification failed.', 401);
    }

    const payload = {
      id: agent.id,
      name: agent.name,
      email: agent.email,
      role: 'support_agent'
    };

    const isBnx = Boolean(agent?.email && String(agent.email).toLowerCase().trim().endsWith('@bnxmail.com'));
    const accessToken = jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: isBnx ? '30d' : '24h' }
    );

    return sendSuccess(res, { accessToken, user: payload }, 'Customer Support Command Clearance Granted.');
  } catch (err) {
    console.error('Support auth anomaly:', err);
    return sendError(res, 'Internal authentication stream failure.', 500);
  }
};

// ── 2. ADMIN PROVISIONING OF SUPPORT AGENTS ────────────────────────────
const getSupportAgents = async (req, res) => {
  try {
    const agents = await db.prepare(`
      SELECT id, name, email, is_active, created_at
      FROM support_agents
      ORDER BY id DESC
    `).all();
    return sendSuccess(res, agents, 'Support roster retrieved successfully.');
  } catch (err) {
    return sendError(res, 'Failed to fetch support roster.', 500);
  }
};

const createSupportAgent = async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return sendError(res, 'Name, email, and password coordinates are mandatory.', 400);
  }

  try {
    const existing = await db.prepare('SELECT id FROM support_agents WHERE email = ?').get(email);
    if (existing) {
      return sendError(res, 'Identity Collision: Email already registered.', 409);
    }

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);
    const now = new Date().toISOString();

    const result = await db.prepare(`
      INSERT INTO support_agents (name, email, password_hash, is_active, created_at)
      VALUES (?, ?, ?, 1, ?)
    `).run([name, email, hash, now]);

    await recordAudit('SUPPORT_PROVISION', `Provisioned support specialist "${name}" (${email})`, req.user.username || req.user.name || 'Admin', 'INFO');

    const created = await db.prepare('SELECT id, name, email, is_active, created_at FROM support_agents WHERE id = ?').get(result.lastInsertRowid);
    return sendSuccess(res, created, 'Support agent registered successfully.', 201);
  } catch (err) {
    console.error('Support provisioning fault:', err);
    return sendError(res, 'Platform support registration pipeline failed.', 500);
  }
};

const toggleSupportAgent = async (req, res) => {
  const { id } = req.params;
  try {
    const agent = await db.prepare('SELECT * FROM support_agents WHERE id = ?').get(id);
    if (!agent) {
      return sendError(res, 'Representative not found.', 404);
    }

    const nextStatus = agent.is_active === 1 ? 0 : 1;
    await db.prepare('UPDATE support_agents SET is_active = ? WHERE id = ?').run([nextStatus, id]);

    await recordAudit('SUPPORT_TOGGLE', `Toggled support specialist "${agent.name}" to is_active=${nextStatus}`, req.user.username || req.user.name || 'Admin', 'WARNING');

    return sendSuccess(res, { id, is_active: nextStatus }, `Support agent status updated successfully.`);
  } catch (err) {
    return sendError(res, 'Failed to toggle representative status.', 500);
  }
};

// ── 3. USER TICKETING INTERACTION (FAQ) ────────────────────────────────
const getUserTickets = async (req, res) => {
  const userId = req.user.id;
  try {
    const tickets = await db.prepare(`
      SELECT t.*, sa.name as agent_name
      FROM support_tickets t
      LEFT JOIN support_agents sa ON t.agent_id = sa.id
      WHERE t.user_id = ?
      ORDER BY t.updated_at DESC, t.id DESC
    `).all(userId);
    return sendSuccess(res, tickets, 'User support tickets loaded.');
  } catch (err) {
    return sendError(res, 'Failed to fetch your support tickets.', 500);
  }
};

const createUserTicket = async (req, res) => {
  const userId = req.user.id;
  const { subject, description, priority } = req.body;
  if (!subject || !description) {
    return sendError(res, 'Subject and description coordinates are mandatory.', 400);
  }

  const now = new Date().toISOString();
  try {
    const result = await db.prepare(`
      INSERT INTO support_tickets (user_id, subject, description, priority, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'OPEN', ?, ?)
    `).run([userId, subject, description, priority || 'MEDIUM', now, now]);

    const created = await db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(result.lastInsertRowid);
    return sendSuccess(res, created, 'Support ticket created successfully.', 201);
  } catch (err) {
    console.error('Failed to create ticket:', err);
    return sendError(res, 'Failed to submit support ticket.', 500);
  }
};

// ── 4. SUPPORT AGENT WORKSPACE ACTIONS ───────────────────────────────
const getAgentTickets = async (req, res) => {
  try {
    const tickets = await db.prepare(`
      SELECT t.*, u.username as user_name, u.email as user_email, sa.name as agent_name
      FROM support_tickets t
      JOIN users u ON t.user_id = u.id
      LEFT JOIN support_agents sa ON t.agent_id = sa.id
      ORDER BY t.updated_at DESC, t.id DESC
    `).all();
    return sendSuccess(res, tickets, 'Global tickets stream loaded.');
  } catch (err) {
    return sendError(res, 'Failed to fetch tickets catalog.', 500);
  }
};

const claimTicket = async (req, res) => {
  const agentId = req.user.id;
  const { id } = req.params;
  const now = new Date().toISOString();

  try {
    const ticket = await db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(id);
    if (!ticket) {
      return sendError(res, 'Ticket not found.', 404);
    }

    if (ticket.agent_id && ticket.agent_id !== agentId) {
      return sendError(res, 'Ticket already claimed by another specialist.', 400);
    }

    await db.prepare(`
      UPDATE support_tickets
      SET agent_id = ?, status = 'OPEN', updated_at = ?
      WHERE id = ?
    `).run([agentId, now, id]);

    const updated = await db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(id);
    return sendSuccess(res, updated, 'Ticket claimed successfully.');
  } catch (err) {
    return sendError(res, 'Failed to claim ticket.', 500);
  }
};

const respondTicket = async (req, res) => {
  const agentId = req.user.id;
  const { id } = req.params;
  const { status, resolution_notes } = req.body;
  const now = new Date().toISOString();

  try {
    const ticket = await db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(id);
    if (!ticket) {
      return sendError(res, 'Ticket not found.', 404);
    }

    if (ticket.agent_id !== agentId) {
      return sendError(res, 'Access Violation: You do not own this ticket.', 403);
    }

    await db.prepare(`
      UPDATE support_tickets
      SET status = ?, resolution_notes = ?, updated_at = ?
      WHERE id = ?
    `).run([status || 'RESOLVED', resolution_notes || '', now, id]);

    const updated = await db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(id);
    return sendSuccess(res, updated, 'Resolution and response logged.');
  } catch (err) {
    return sendError(res, 'Failed to respond to ticket.', 500);
  }
};

const escalateTicket = async (req, res) => {
  const agentId = req.user.id;
  const { id } = req.params;
  const { admin_note } = req.body;
  const now = new Date().toISOString();

  if (!admin_note) {
    return sendError(res, 'Escalation context note is mandatory.', 400);
  }

  try {
    const ticket = await db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(id);
    if (!ticket) {
      return sendError(res, 'Ticket not found.', 404);
    }

    if (ticket.agent_id !== agentId) {
      return sendError(res, 'Access Violation: You do not own this ticket.', 403);
    }

    await db.prepare(`
      UPDATE support_tickets
      SET status = 'ESCALATED', admin_note = ?, updated_at = ?
      WHERE id = ?
    `).run([admin_note, now, id]);

    const updated = await db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(id);
    return sendSuccess(res, updated, 'Ticket successfully escalated to administration.');
  } catch (err) {
    return sendError(res, 'Failed to escalate ticket.', 500);
  }
};

// ── 5. ADMIN RESOLUTION OF ESCALATED TICKETS ───────────────────────────
const getEscalatedTickets = async (req, res) => {
  try {
    const tickets = await db.prepare(`
      SELECT t.*, u.username as user_name, u.email as user_email, sa.name as agent_name
      FROM support_tickets t
      JOIN users u ON t.user_id = u.id
      LEFT JOIN support_agents sa ON t.agent_id = sa.id
      WHERE t.status = 'ESCALATED'
      ORDER BY t.updated_at DESC, t.id DESC
    `).all();
    return sendSuccess(res, tickets, 'Escalated tickets registry loaded.');
  } catch (err) {
    return sendError(res, 'Failed to fetch escalated tickets.', 500);
  }
};

const resolveEscalatedTicket = async (req, res) => {
  const { id } = req.params;
  const { resolution_notes } = req.body;
  const now = new Date().toISOString();

  try {
    const ticket = await db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(id);
    if (!ticket) {
      return sendError(res, 'Ticket not found.', 404);
    }

    await db.prepare(`
      UPDATE support_tickets
      SET status = 'RESOLVED', resolution_notes = ?, updated_at = ?
      WHERE id = ?
    `).run([resolution_notes || 'Resolved by Platform Administrator.', now, id]);

    await recordAudit('ADMIN_RESOLVE_TICKET', `Resolved escalated support ticket ID ${id}`, req.user.username || req.user.name || 'Admin', 'INFO');

    const updated = await db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(id);
    return sendSuccess(res, updated, 'Escalated ticket resolved successfully by administrator.');
  } catch (err) {
    return sendError(res, 'Failed to resolve escalated ticket.', 500);
  }
};

module.exports = {
  supportAgentLogin,
  getSupportAgents,
  createSupportAgent,
  toggleSupportAgent,
  getUserTickets,
  createUserTicket,
  getAgentTickets,
  claimTicket,
  respondTicket,
  escalateTicket,
  getEscalatedTickets,
  resolveEscalatedTicket
};
