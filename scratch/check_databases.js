const Database = require('better-sqlite3');
const fs = require('fs');
const paths = ['./db/books_finance.db', './books_finance.db', './db/finance.db', './database.sqlite'];

for (const p of paths) {
  if (fs.existsSync(p)) {
    console.log(`--- Checking Database at: ${p} ---`);
    try {
      const db = new Database(p);
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
      console.log("Tables:", tables.map(t => t.name));
      if (tables.some(t => t.name === 'people_reminders')) {
        const count = db.prepare("SELECT COUNT(*) as cnt FROM people_reminders").get().cnt;
        console.log(`people_reminders count: ${count}`);
        if (count > 0) {
          const rows = db.prepare("SELECT * FROM people_reminders").all();
          console.log("Rows:", JSON.stringify(rows, null, 2));
        }
      }
    } catch (e) {
      console.error(`Error checking ${p}:`, e.message);
    }
  } else {
    console.log(`File not found: ${p}`);
  }
}
