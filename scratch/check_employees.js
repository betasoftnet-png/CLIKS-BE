const Database = require('better-sqlite3');
const db = new Database('./db/books_finance.db');

try {
  const info = db.prepare("PRAGMA table_info(expenses)").all();
  console.log("expenses schema:\n", info.map(c => `${c.name} (${c.type})`).join(', '));
} catch (e) {
  console.error("Error:", e.message);
}
