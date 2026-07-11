const db = require('../db/connection');

async function test() {
  try {
    const stmt = db.prepare(`
      INSERT INTO people_reminders (person_id, user_id, title, message, amount, due_date, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    const info = await stmt.run('1', 5, 'Test Stmt Run', null, 9000, '2026-07-30', 'pending', now, now);
    console.log('Stmt Run Info:', info);

    const rows = await db.prepare("SELECT * FROM people_reminders WHERE title = 'Test Stmt Run'").all();
    console.log('Inserted Rows:', rows);
  } catch (err) {
    console.error(err);
  }
}

test();
