const db = require('../db/connection');

async function check() {
  try {
    const rows = await db.prepare("SELECT * FROM people_reminders").all();
    console.log("People Reminders Rows:", JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error("Error:", err);
  }
}

check();
