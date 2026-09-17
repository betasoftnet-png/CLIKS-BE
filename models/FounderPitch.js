const db = require('../db/connection');

let tableEnsured = false;

async function ensureTable() {
  if (tableEnsured) return;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS founder_pitches (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255),
        founder_name VARCHAR(255) NOT NULL,
        founder_email VARCHAR(255) NOT NULL,
        venture_name VARCHAR(255) NOT NULL,
        sector VARCHAR(100) NOT NULL,
        headline_pitch TEXT NOT NULL,
        description TEXT NOT NULL,
        pitch_deck_url TEXT,
        review_status VARCHAR(50) DEFAULT 'Published',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    tableEnsured = true;
  } catch (pgErr) {
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS founder_pitches (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT,
          founder_name TEXT NOT NULL,
          founder_email TEXT NOT NULL,
          venture_name TEXT NOT NULL,
          sector TEXT NOT NULL,
          headline_pitch TEXT NOT NULL,
          description TEXT NOT NULL,
          pitch_deck_url TEXT,
          review_status TEXT DEFAULT 'Published',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      tableEnsured = true;
    } catch (sqErr) {
      console.error('FounderPitch table initialization warning:', sqErr.message);
    }
  }
}

const FounderPitch = {
  ensureTable,

  async create(data) {
    await ensureTable();
    const {
      user_id = '1',
      founder_name,
      founder_email,
      venture_name,
      sector = 'Technology',
      headline_pitch = '',
      description = '',
      pitch_deck_url = '',
      review_status = 'Published',
      created_at = new Date().toISOString()
    } = data;

    const result = await db.prepare(`
      INSERT INTO founder_pitches (
        user_id, founder_name, founder_email, venture_name, sector,
        headline_pitch, description, pitch_deck_url, review_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run([
      String(user_id),
      founder_name || 'Innovator Founder',
      founder_email || 'founder@cliksbusiness.com',
      venture_name || 'Venture',
      sector || 'Technology',
      headline_pitch,
      description,
      pitch_deck_url,
      review_status,
      created_at
    ]);

    const newId = result?.lastInsertRowid || result?.id || null;
    return {
      id: newId,
      user_id: String(user_id),
      founder_name: founder_name || 'Innovator Founder',
      founder_email: founder_email || 'founder@cliksbusiness.com',
      venture_name: venture_name || 'Venture',
      sector: sector || 'Technology',
      headline_pitch,
      description,
      pitch_deck_url,
      review_status,
      created_at
    };
  },

  async getAll() {
    await ensureTable();
    try {
      const rows = await db.prepare(
        'SELECT * FROM founder_pitches ORDER BY created_at DESC, id DESC'
      ).all();
      return Array.isArray(rows) ? rows : [];
    } catch (e) {
      console.error('Error fetching founder_pitches:', e.message);
      return [];
    }
  }
};

module.exports = FounderPitch;
