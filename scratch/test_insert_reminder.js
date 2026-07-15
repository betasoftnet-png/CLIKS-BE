const db = require('../db/connection');

async function run() {
  try {
    const now = new Date().toISOString();
    // Let's find a valid person_id and user_id first, or check users and people table
    const users = await db.prepare("SELECT * FROM users").all();
    console.log("Users:", users);
    
    const people = await db.prepare("SELECT * FROM people").all();
    console.log("People:", people);

    if (users.length > 0 && people.length > 0) {
      const uId = users[0].id;
      const pId = people[0].id;
      
      console.log(`Inserting test reminder for person_id ${pId}, user_id ${uId}...`);
      const stmt = db.prepare(`
        INSERT INTO people_reminders (person_id, user_id, title, message, amount, due_date, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const info = await stmt.run(pId, uId, "Test Claim Cap", "Memo test", 456.0, "2026-07-13", "pending", now, now);
      console.log("Insert result info:", info);
      
      const rows = await db.prepare("SELECT * FROM people_reminders WHERE id = ?").all(info.lastInsertRowid);
      console.log("Inserted Row:", rows);
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

run();
