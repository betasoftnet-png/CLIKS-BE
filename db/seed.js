const bcrypt = require('bcryptjs');
const db = require('./connection');

async function seedDefaultUser() {
  const row = await db.prepare('SELECT COUNT(*) as count FROM users').get();
  
  if (Number(row.count) === 0) {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync('password123', salt);
    
    const stmt = db.prepare(`
      INSERT INTO users (username, email, password_hash, created_at, updated_at) 
      VALUES (?, ?, ?, ?, ?)
    `);
    
    const now = new Date().toISOString();
    await stmt.run('BTC007', 'btc007@finance.app', hash, now, now);
    console.log("✅ Default user seeded");
  } else {
    console.log("⏭ Seed skipped — users exist");
  }
}

module.exports = { seedDefaultUser };
