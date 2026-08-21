const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../db/books_finance.db');
const db = new Database(dbPath);

console.log('--- TABLES ---');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log(tables.map(t => t.name));

console.log('\n--- WAREHOUSES ---');
try {
    const whs = db.prepare("SELECT * FROM warehouses").all();
    console.log(whs);
} catch (e) {
    console.log('Error querying warehouses:', e.message);
}

console.log('\n--- PRODUCTS (electric light / Chennai / all) ---');
try {
    const prods = db.prepare("SELECT id, user_id, name, sku, quantity, warehouse_id FROM business_products WHERE LOWER(name) LIKE '%electric%' OR LOWER(name) LIKE '%light%' OR LOWER(warehouse_id) LIKE '%chennai%'").all();
    console.log(prods);
} catch (e) {
    console.log('Error querying business_products:', e.message);
}

console.log('\n--- ALL PRODUCTS ---');
try {
    const allProds = db.prepare("SELECT id, user_id, name, sku, quantity, warehouse_id FROM business_products").all();
    console.log(allProds);
} catch (e) {
    console.log('Error querying all business_products:', e.message);
}

console.log('\n--- STOCK ---');
try {
    const stocks = db.prepare("SELECT * FROM stock").all();
    console.log(stocks);
} catch (e) {
    console.log('Error querying stock:', e.message);
}

console.log('\n--- RETURNS ---');
try {
    const returns = db.prepare("SELECT id, return_number, warehouse_id, status FROM business_returns").all();
    console.log(returns);
} catch (e) {
    console.log('Error querying business_returns:', e.message);
}
