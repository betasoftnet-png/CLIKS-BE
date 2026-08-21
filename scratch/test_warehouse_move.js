const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../db/books_finance.db');
const db = new Database(dbPath);

console.log('=== TEST: Move to Warehouse (Avadi -> electric light + 3) ===');

const userId = 1;
const warehouseName = 'Avadi';
const prodName = 'electric light';
const prodSku = 'SKU-783277';
const returnQty = 3;
const now = new Date().toISOString();

// 1. Ensure Avadi warehouse exists in DB
let wh = db.prepare("SELECT * FROM warehouses WHERE user_id = ? AND (LOWER(name) = ? OR LOWER(code) = ?)").get(userId, warehouseName.toLowerCase(), warehouseName.toLowerCase());
if (!wh) {
    const res = db.prepare("INSERT INTO warehouses (user_id, code, name, type, status, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(userId, 'wh-09', warehouseName, 'godown', 'active', now);
    wh = db.prepare("SELECT * FROM warehouses WHERE id = ?").get(res.lastInsertRowid);
}
console.log('Target Warehouse:', wh);

// 2. Ensure initial stock for electric light in Avadi is 13 (if not present)
let existingProd = db.prepare("SELECT * FROM business_products WHERE user_id = ? AND LOWER(name) = ? AND (LOWER(warehouse_id) = ? OR warehouse_id IS NULL OR warehouse_id = '')").get(userId, prodName.toLowerCase(), warehouseName.toLowerCase());
if (!existingProd) {
    const res = db.prepare(`
        INSERT INTO business_products (user_id, name, sku, category, unit, quantity, purchase_price, selling_price, warehouse_id, stock_status, created_at, updated_at)
        VALUES (?, ?, ?, 'General', 'PCS', 13, 100, 150, ?, 'In Stock', ?, ?)
    `).run(userId, prodName, prodSku, warehouseName, now, now);
    existingProd = db.prepare("SELECT * FROM business_products WHERE id = ?").get(res.lastInsertRowid);
}
console.log('\n[BEFORE UPDATE] Product in DB:', existingProd);

// 3. RUN WAREHOUSE UPDATE LOGIC (simulating returnsController.js updateReturn)
// Step 3a: Update business_products
let whProd = db.prepare(`
    SELECT * FROM business_products 
    WHERE user_id = ? 
      AND (
        LOWER(warehouse_id) = ? OR LOWER(warehouse_id) = ? OR warehouse_id IS NULL OR warehouse_id = ''
      )
      AND (LOWER(name) = ? OR (sku IS NOT NULL AND LOWER(sku) = ?))
    LIMIT 1
`).get(userId, String(wh.id).toLowerCase(), warehouseName.toLowerCase(), prodName.toLowerCase(), prodSku.toLowerCase());

if (whProd) {
    const newQty = (parseFloat(whProd.quantity) || 0) + returnQty;
    db.prepare(`
        UPDATE business_products SET 
            quantity = ?, 
            warehouse_id = ?, 
            stock_status = 'In Stock', 
            updated_at = ? 
        WHERE id = ? AND user_id = ?
    `).run(newQty, warehouseName, now, whProd.id, userId);
} else {
    db.prepare(`
        INSERT INTO business_products (user_id, name, sku, category, unit, quantity, purchase_price, selling_price, warehouse_id, stock_status, created_at, updated_at)
        VALUES (?, ?, ?, 'General', 'PCS', ?, 100, 150, ?, 'In Stock', ?, ?)
    `).run(userId, prodName, prodSku, returnQty, warehouseName, now, now);
}

// Step 3b: Update stock table (column location)
let whStock = db.prepare(`
    SELECT * FROM stock 
    WHERE user_id = ? 
      AND (LOWER(location) = ? OR location IS NULL) 
      AND (LOWER(name) = ? OR (sku IS NOT NULL AND LOWER(sku) = ?))
    LIMIT 1
`).get(userId, warehouseName.toLowerCase(), prodName.toLowerCase(), prodSku.toLowerCase());

if (whStock) {
    db.prepare("UPDATE stock SET quantity = quantity + ?, location = ?, updated_at = ? WHERE id = ?")
        .run(returnQty, warehouseName, now, whStock.id);
} else {
    db.prepare(`
        INSERT INTO stock (user_id, name, sku, category, unit, unit_price, quantity, location, created_at, updated_at)
        VALUES (?, ?, ?, 'General', 'PCS', 100, ?, ?, ?, ?)
    `).run(userId, prodName, prodSku, returnQty, warehouseName, now, now);
}

// 4. VERIFY DATABASE AFTER UPDATE
const updatedProd = db.prepare("SELECT * FROM business_products WHERE id = ?").get(whProd ? whProd.id : existingProd.id);
console.log('\n[AFTER UPDATE] Product in DB:', updatedProd);

// 5. SIMULATE FRONTEND WAREHOUSE PRODUCTS LIST FILTERING (BusinessWarehouse.jsx line 328)
const allProds = db.prepare("SELECT * FROM business_products WHERE user_id = ?").all(userId);
const filteredForAvadi = allProds.filter(p => {
    const pWhId = String(p.warehouse_id || '').toLowerCase();
    const targetName = warehouseName.toLowerCase();
    return pWhId === targetName || pWhId.includes(targetName);
});

console.log('\n[SIMULATION] Products retrieved for Avadi Products List modal:');
console.log(filteredForAvadi);
if (filteredForAvadi.length > 0 && filteredForAvadi[0].quantity === 16) {
    console.log('\n✅ TEST SUCCESSFUL! Avadi Products List shows electric light = 16 PCS');
} else {
    console.log('\n❌ TEST FAILED!');
}
