const db = require('../db/connection');

async function test() {
  const req = {
    user: { id: 1 },
    body: {
      account_id: null,
      type: 'Income',
      amount: 100,
      category: 'Income',
      description: 'Test transaction',
      date: new Date().toISOString()
    }
  };

  const { account_id, type, amount, category, description, title, date } = req.body;
  
  try {
    const normalizedType = type.toLowerCase();
    const dbDescription = description || title || null;
    const now = new Date().toISOString();

    console.log("Preparing statement...");
    const stmt = db.prepare(`
      INSERT INTO transactions (user_id, account_id, type, amount, category, description, date, created_at, updated_at) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    console.log("Running statement...");
    const info = await stmt.run(req.user.id, account_id || null, normalizedType, amount, category || null, dbDescription, date || now, now, now);
    
    console.log("Statement run info:", info);
    
    console.log("Fetching new item...");
    const newItem = await db.prepare('SELECT * FROM transactions WHERE id = ?').get(info.lastInsertRowid);
    console.log("New item fetched:", newItem);
  } catch (err) {
    console.error("Test failed with error:", err);
  }
}

test();
