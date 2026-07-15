const Database = require('better-sqlite3');
const db = new Database('./db/books_finance.db');

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
for (const t of tables.map(x => x.name)) {
  try {
    const count = db.prepare(`SELECT COUNT(*) as cnt FROM ${t}`).get().cnt;
    if (count > 0) {
      console.log(`Table ${t} has ${count} rows`);
      if (t === 'users' || t === 'people' || t === 'people_reminders' || t === 'people_transactions') {
        const rows = db.prepare(`SELECT * FROM ${t} LIMIT 5`).all();
        console.log(`Sample rows from ${t}:`, rows);
      }
    }
  } catch (e) {
    // ignore
  }
}
