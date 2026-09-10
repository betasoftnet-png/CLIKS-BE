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

async function seedSalesAgent() {
  try {
    const email = 'agent@cliks.com';
    const row = await db.prepare('SELECT COUNT(*) as count FROM sales_agents WHERE email = ?').get(email);
    
    if (Number(row?.count || 0) === 0) {
      const password = 'agentpassword123';
      const salt = bcrypt.genSaltSync(10);
      const hash = bcrypt.hashSync(password, salt);
      
      const now = new Date().toISOString();
      await db.prepare(`
        INSERT INTO sales_agents (name, email, password_hash, commission_rate, is_active, created_at)
        VALUES (?, ?, ?, ?, 1, ?)
      `).run('Default Sales Agent', email, hash, 10.0, now);
      
      console.log(`✅ Default Sales Agent seeded: ${email}`);
    }
  } catch (e) {
    console.warn('⚠️ Warning: Could not seed sales agent:', e.message);
  }
}

async function seedPlatformAdmin() {
  try {
    const email = 'santhoshhhhhhh@bnxmail.com';
    const password = '1234';
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);
    const now = new Date().toISOString();
    
    // 1. Seed platform_admins
    const adminRow = await db.prepare('SELECT id FROM platform_admins WHERE LOWER(email) = LOWER(?)').get(email);
    if (!adminRow) {
      await db.prepare(`
        INSERT INTO platform_admins (name, email, password_hash, created_at)
        VALUES (?, ?, ?, ?)
      `).run('Santhosh Admin', email, hash, now);
      console.log(`✅ Capital Matrix Admin seeded in platform_admins: ${email}`);
    } else {
      await db.prepare('UPDATE platform_admins SET password_hash = ? WHERE LOWER(email) = LOWER(?)').run(hash, email);
    }

    // 2. Seed users table
    const userRow = await db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(email);
    if (!userRow) {
      await db.prepare(`
        INSERT INTO users (username, email, password_hash, role, created_at)
        VALUES (?, ?, ?, 'ADMIN', ?)
      `).run('santhoshhhhhhh', email, hash, now);
      console.log(`✅ Capital Matrix Admin seeded in users table: ${email}`);
    } else {
      await db.prepare("UPDATE users SET password_hash = ?, role = 'ADMIN' WHERE LOWER(email) = LOWER(?)").run(hash, email);
    }
  } catch (e) {
    console.warn('⚠️ Warning: Could not seed platform admin:', e.message);
  }
}

module.exports = { seedDefaultUser, seedSalesAgent, seedPlatformAdmin };

