const db = require('../db/connection');
const { runMigrations } = require('../db/migrations');

async function test() {
  try {
    await runMigrations();

    // 1. Insert a user
    const now = new Date().toISOString();
    let user = await db.prepare("SELECT * FROM users WHERE id = 1").get();
    if (!user) {
      await db.prepare("INSERT INTO users (id, username, email, password_hash, created_at, updated_at) VALUES (1, 'Test', 'test@test.com', 'hash', ?, ?)").run(now, now);
      user = { id: 1 };
    }

    // 2. Insert a contact "gowtham"
    let person = await db.prepare("SELECT * FROM people WHERE name = 'gowtham'").get();
    if (!person) {
      const info = await db.prepare("INSERT INTO people (user_id, name, role_type, created_at, updated_at) VALUES (1, 'gowtham', 'friend', ?, ?)").run(now, now);
      person = { id: info.lastInsertRowid };
    }

    // 3. Insert a reminder with amount 456
    const remInfo = await db.prepare(`
      INSERT INTO people_reminders (person_id, user_id, title, message, amount, due_date, status, created_at, updated_at)
      VALUES (?, 1, '567', null, 456.0, '2026-07-13', 'pending', ?, ?)
    `).run(person.id, now, now);

    // 4. Query the reminder exactly how getAllReminders does
    const rows = await db.prepare(`
      SELECT pr.*, p.name as person_name 
      FROM people_reminders pr 
      JOIN people p ON pr.person_id = p.id 
      WHERE pr.user_id = 1
    `).all();

    console.log("Queried rows from DB:", JSON.stringify(rows, null, 2));

  } catch (err) {
    console.error("Test error:", err);
  }
}

test();
