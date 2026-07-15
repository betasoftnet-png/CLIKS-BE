const Database = require('better-sqlite3');
const db = new Database('./db/books_finance.db');

try {
  const info = db.prepare("PRAGMA table_info(people)").all();
  console.log("people Table Schema:", info);
} catch (e) {
  console.error("Error getting schema:", e.message);
}
