const db = require('../db/connection');

let tableEnsured = false;

const isPostgres = (process.env.DB_TYPE || '').toLowerCase() === 'postgres';

async function ensureTable() {
  if (tableEnsured) return;
  try {
    if (isPostgres) {
      await db.query(`
        CREATE TABLE IF NOT EXISTS repayment_alerts (
          id SERIAL PRIMARY KEY,
          user_id VARCHAR(255) NOT NULL,
          business_id VARCHAR(255),
          contact_id VARCHAR(255),
          target_contact VARCHAR(255) NOT NULL,
          contact_phone VARCHAR(50),
          maturity_date DATE NOT NULL,
          memo_label VARCHAR(255) NOT NULL,
          claim_cap NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
          status VARCHAR(50) DEFAULT 'Pending',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `);
      try {
        await db.query(`CREATE INDEX IF NOT EXISTS idx_repayment_alerts_user ON repayment_alerts(user_id)`);
      } catch (e) {}
    } else {
      if (db.raw && typeof db.raw.exec === 'function') {
        db.raw.exec(`
          CREATE TABLE IF NOT EXISTS repayment_alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            business_id TEXT,
            contact_id TEXT,
            target_contact TEXT NOT NULL,
            contact_phone TEXT,
            maturity_date TEXT NOT NULL,
            memo_label TEXT NOT NULL,
            claim_cap REAL NOT NULL DEFAULT 0.00,
            status TEXT DEFAULT 'Pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX IF NOT EXISTS idx_repayment_alerts_user ON repayment_alerts(user_id);
        `);
      } else {
        await db.prepare(`
          CREATE TABLE IF NOT EXISTS repayment_alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            business_id TEXT,
            contact_id TEXT,
            target_contact TEXT NOT NULL,
            contact_phone TEXT,
            maturity_date TEXT NOT NULL,
            memo_label TEXT NOT NULL,
            claim_cap REAL NOT NULL DEFAULT 0.00,
            status TEXT DEFAULT 'Pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `).run();
        try {
          await db.prepare(`CREATE INDEX IF NOT EXISTS idx_repayment_alerts_user ON repayment_alerts(user_id)`).run();
        } catch (e) {}
      }
    }
    tableEnsured = true;
  } catch (err) {
    console.error('RepaymentAlert table initialization note:', err.message);
  }
}

const RepaymentAlert = {
  ensureTable,

  async create(data) {
    await ensureTable();
    const {
      user_id,
      business_id = null,
      contact_id = null,
      target_contact,
      contact_phone = null,
      maturity_date,
      memo_label,
      claim_cap = 0,
      status = 'Pending'
    } = data;

    const params = [
      String(user_id),
      business_id ? String(business_id) : null,
      contact_id ? String(contact_id) : null,
      target_contact || 'Contact',
      contact_phone || null,
      maturity_date,
      memo_label || 'Repayment Alert',
      Number(claim_cap) || 0,
      status || 'Pending'
    ];
    const result = await db.prepare(`
      INSERT INTO repayment_alerts (
        user_id, business_id, contact_id, target_contact, contact_phone,
        maturity_date, memo_label, claim_cap, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(...params);

    const newId = result?.lastInsertRowid || result?.id || null;
    return {
      id: newId,
      user_id: String(user_id),
      business_id,
      contact_id: contact_id ? String(contact_id) : null,
      person_id: contact_id ? String(contact_id) : null,
      target_contact: target_contact || 'Contact',
      person_name: target_contact || 'Contact',
      contact_phone,
      maturity_date,
      due_date: maturity_date,
      memo_label: memo_label || 'Repayment Alert',
      title: memo_label || 'Repayment Alert',
      claim_cap: Number(claim_cap) || 0,
      amount: Number(claim_cap) || 0,
      status: status || 'Pending',
      created_at: new Date().toISOString()
    };
  },

  async getAll(userId) {
    await ensureTable();
    try {
      const rows = await db.prepare(`
        SELECT * FROM repayment_alerts 
        WHERE user_id = ? 
        ORDER BY maturity_date ASC, id DESC
      `).all(String(userId));

      return (rows || []).map(r => ({
        id: r.id,
        user_id: r.user_id,
        business_id: r.business_id,
        contact_id: r.contact_id,
        person_id: r.contact_id,
        target_contact: r.target_contact,
        person_name: r.target_contact,
        contact_phone: r.contact_phone,
        maturity_date: r.maturity_date,
        due_date: r.maturity_date,
        memo_label: r.memo_label,
        title: r.memo_label,
        claim_cap: Number(r.claim_cap) || 0,
        amount: Number(r.claim_cap) || 0,
        status: r.status || 'Pending',
        created_at: r.created_at
      }));
    } catch (e) {
      console.error('Error fetching repayment_alerts:', e.message);
      return [];
    }
  },

  async delete(id, userId) {
    await ensureTable();
    try {
      await db.prepare(`
        DELETE FROM repayment_alerts 
        WHERE id = ? AND user_id = ?
      `).run(id, String(userId));
      return true;
    } catch (e) {
      console.error('Error deleting repayment_alert:', e.message);
      return false;
    }
  },

  async updateStatus(id, userId, status) {
    await ensureTable();
    try {
      await db.prepare(`
        UPDATE repayment_alerts 
        SET status = ? 
        WHERE id = ? AND user_id = ?
      `).run(status, id, String(userId));
      return true;
    } catch (e) {
      console.error('Error updating repayment_alert status:', e.message);
      return false;
    }
  }
};

module.exports = RepaymentAlert;
