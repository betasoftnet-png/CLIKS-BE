const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/connection');
const { sendSuccess, sendError } = require('../utils/response');

/**
 * Authenticates an active Sales Agent.
 */
const salesAgentLogin = async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return sendError(res, 'Email and password coordinates required.', 400);
  }

  try {
    const agent = await db.prepare('SELECT * FROM sales_agents WHERE email = ?').get(email);
    
    if (!agent) {
      return sendError(res, 'Access Violation: Invalid representative credentials.', 401);
    }

    if (agent.is_active === 0) {
      return sendError(res, 'Platform Hold: Your agent clearance is currently restricted.', 403);
    }

    const isMatch = await bcrypt.compare(password, agent.password_hash);
    if (!isMatch) {
      return sendError(res, 'Access Violation: Secure validation failed.', 401);
    }

    const payload = {
      id: agent.id,
      name: agent.name,
      email: agent.email,
      role: 'sales_agent'
    };

    const accessToken = jwt.sign(
      payload, 
      process.env.JWT_SECRET, 
      { expiresIn: '24h' }
    );

    const safeAgent = {
      id: agent.id,
      name: agent.name,
      email: agent.email,
      role: 'sales_agent'
    };

    return sendSuccess(res, { accessToken, user: safeAgent }, 'Sales Agent Command Authorization Granted.');
  } catch (err) {
    console.error('Sales authentication anomaly:', err);
    return sendError(res, 'Internal authentication stream failure.', 500);
  }
};

/**
 * Streams leads assigned explicitly to the currently authenticated Sales Agent.
 */
const getAgentLeads = async (req, res) => {
  const agentId = req.user.id;
  try {
    const leads = await db.prepare(`
      SELECT * FROM sales_leads 
      WHERE agent_id = ? 
      ORDER BY updated_at DESC, id DESC
    `).all(agentId);
    return sendSuccess(res, leads, 'Assigned prospect tracking grid streams loaded.');
  } catch (err) {
    return sendError(res, 'Failed to load agent prospect catalog.', 500);
  }
};

/**
 * Inserts a newly acquired Prospect into the pipeline tracker.
 */
const createLead = async (req, res) => {
  const agentId = req.user.id;
  const { business_name, contact_name, email, phone, estimated_value, notes } = req.body;

  if (!business_name) {
    return sendError(res, 'Target business vector name is mandatory.', 400);
  }

  const now = new Date().toISOString();
  try {
    const result = await db.prepare(`
      INSERT INTO sales_leads (
        agent_id, business_name, contact_name, email, phone, 
        status, estimated_value, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'NEW', ?, ?, ?, ?)
    `).run([
      agentId, business_name, contact_name, email, phone, 
      Number(estimated_value || 0), notes, now, now
    ]);

    const insertedId = result.lastInsertRowid;
    const newLead = await db.prepare('SELECT * FROM sales_leads WHERE id = ?').get(insertedId);

    return sendSuccess(res, newLead, 'Prospect recorded successfully in active stream pipeline.', 201);
  } catch (err) {
    console.error('Failed to create lead:', err);
    return sendError(res, 'Target acquisition creation fault.', 500);
  }
};

/**
 * Modifies status, notes, and value grids for existing leads.
 */
const updateLead = async (req, res) => {
  const { id } = req.params;
  const agentId = req.user.id;
  const { status, notes, estimated_value, contact_name, email, phone } = req.body;

  try {
    // 1. Secure validation - ensure ownership
    const lead = await db.prepare('SELECT id FROM sales_leads WHERE id = ? AND agent_id = ?').get(id, agentId);
    if (!lead) {
      return sendError(res, 'Lead vector not matched or access restricted.', 404);
    }

    const now = new Date().toISOString();
    await db.prepare(`
      UPDATE sales_leads 
      SET status = COALESCE(?, status),
          notes = COALESCE(?, notes),
          estimated_value = COALESCE(?, estimated_value),
          contact_name = COALESCE(?, contact_name),
          email = COALESCE(?, email),
          phone = COALESCE(?, phone),
          updated_at = ?
      WHERE id = ?
    `).run([status, notes, estimated_value, contact_name, email, phone, now, id]);

    const updated = await db.prepare('SELECT * FROM sales_leads WHERE id = ?').get(id);
    return sendSuccess(res, updated, 'Prospect mapping matrix aligned.');
  } catch (err) {
    return sendError(res, 'Failed to mutate prospect matrix data.', 500);
  }
};

/**
 * Provides real-time analytics vectors specifically tailored for the active agent's dashboard summary.
 */
const getAgentStats = async (req, res) => {
  const agentId = req.user.id;
  try {
    const stats = await db.prepare(`
      SELECT 
        COUNT(*) as total_leads,
        COALESCE(SUM(CASE WHEN status = 'NEW' THEN 1 ELSE 0 END), 0) as new_leads,
        COALESCE(SUM(CASE WHEN status = 'CONVERTED' THEN 1 ELSE 0 END), 0) as conversions,
        COALESCE(SUM(estimated_value), 0) as gross_pipeline
      FROM sales_leads
      WHERE agent_id = ?
    `).get(agentId);

    return sendSuccess(res, stats, 'Agent telemetry snapshot initialized.');
  } catch (err) {
    return sendError(res, 'Failed to stream agent performance telemetry.', 500);
  }
};

module.exports = {
  salesAgentLogin,
  getAgentLeads,
  createLead,
  updateLead,
  getAgentStats
};
