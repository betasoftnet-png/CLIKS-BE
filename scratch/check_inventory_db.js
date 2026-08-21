const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../db/books_finance.db');
const db = new Database(dbPath);

console.log('--- WAREHOUSES ---');
const whs = db.prepare("SELECT * FROM warehouses").all();
console.log(whs);

console.log('\n--- RETURNS ---');
const returns = db.prepare("SELECT * FROM business_returns").all();
console.log(returns);

console.log('\n--- RETURN ITEMS ---');
try {
    const items = db.prepare("SELECT * FROM business_return_items").all();
    console.log(items);
} catch(e) {
    console.log(e.message);
}

console.log('\n--- PRODUCTS ---');
const prods = db.prepare("SELECT id, user_id, name, sku, quantity, warehouse_id FROM business_products").all();
console.log(prods);

console.log('\n--- STOCK ---');
const stocks = db.prepare("SELECT * FROM stock").all();
console.log(stocks);
