const Database = require('better-sqlite3');
const fs = require('fs');
const db = new Database('./db/books_finance.db');
const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table'").all();
let output = '';
for (const t of tables) {
  output += `\n--- Schema for table ${t.name} ---\n${t.sql}\n`;
}
fs.writeFileSync('./scratch/db_schema.txt', output, 'utf8');
console.log('Schema written to ./scratch/db_schema.txt');


