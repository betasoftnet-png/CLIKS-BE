const Database = require('better-sqlite3');
const db = new Database('./db/books_finance.db');

console.log("--- 10 Sample Accounting Entries ---");
console.log(db.prepare("SELECT * FROM accounting LIMIT 10").all());

console.log("\n--- Distinct Categories in Accounting ---");
console.log(db.prepare("SELECT DISTINCT category, entry_type, mode FROM accounting").all());

console.log("\n--- Distinct Entry Types in Accounting ---");
console.log(db.prepare("SELECT DISTINCT entry_type FROM accounting").all());

console.log("\n--- Sample Invoices ---");
console.log(db.prepare("SELECT * FROM business_invoices LIMIT 5").all());

console.log("\n--- Sample Expenses ---");
console.log(db.prepare("SELECT * FROM expenses LIMIT 5").all());
