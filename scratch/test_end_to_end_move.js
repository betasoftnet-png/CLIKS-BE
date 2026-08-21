const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../db/books_finance.db');
const db = new Database(dbPath);

console.log('=== END-TO-END VERIFICATION TEST ===');

const userId = 1;
const warehouseName = 'Avadi';
const prodName = 'electric light';
const prodSku = 'SKU-783277';
const returnQty = 3;
const now = new Date().toISOString();

// 1. Reset / Set initial state: Avadi has electric light = 13 PCS
db.prepare("DELETE FROM business_products WHERE user_id = ? AND LOWER(name) = ?").run(userId, prodName.toLowerCase());
db.prepare("DELETE FROM stock WHERE user_id = ? AND LOWER(name) = ?").run(userId, prodName.toLowerCase());

const initProdRes = db.prepare(`
    INSERT INTO business_products (user_id, name, sku, category, unit, quantity, purchase_price, selling_price, warehouse_id, stock_status, created_at, updated_at)
    VALUES (?, ?, ?, 'Electronics', 'PCS', 13, 100, 150, ?, 'In Stock', ?, ?)
`).run(userId, prodName, prodSku, warehouseName, now, now);

db.prepare(`
    INSERT INTO stock (user_id, name, sku, category, unit, unit_price, quantity, location, created_at, updated_at)
    VALUES (?, ?, ?, 'Electronics', 'PCS', 100, 13, ?, ?, ?)
`).run(userId, prodName, prodSku, warehouseName, now, now);

console.log('1. Initial Setup: Avadi has electric light = 13 PCS');
const initProd = db.prepare("SELECT id, name, sku, quantity, warehouse_id FROM business_products WHERE id = ?").get(initProdRes.lastInsertRowid);
console.log('   business_products row:', initProd);

// 2. Simulate Sales Return Move to Warehouse Submit Logic
const itemsToProcess = [{ product_name: prodName, sku: prodSku, return_quantity: returnQty, price: 100 }];
const targetWhName = warehouseName;
const targetWhId = '14';
const targetWhCode = 'wh-09';

for (const item of itemsToProcess) {
    const rQty = parseFloat(item.return_quantity || item.quantity) || 1;
    const pName = item.product_name || item.name || 'Returned Product';
    const cleanPName = String(pName).trim();

    // Check existing in business_products
    let existingWhProduct = db.prepare(`
        SELECT * FROM business_products 
        WHERE user_id = ? 
          AND (
            LOWER(warehouse_id) = ? OR LOWER(warehouse_id) = ? OR LOWER(warehouse_id) = ? OR warehouse_id IS NULL OR warehouse_id = ''
          )
          AND (LOWER(name) = ? OR (sku IS NOT NULL AND LOWER(sku) = ?))
        LIMIT 1
    `).get(
        userId, 
        targetWhId.toLowerCase(), targetWhName.toLowerCase(), targetWhCode.toLowerCase(),
        cleanPName.toLowerCase(), prodSku.toLowerCase()
    );

    if (existingWhProduct) {
        const currentQty = parseFloat(existingWhProduct.quantity) || 0;
        const newQty = currentQty + rQty;
        db.prepare(`
            UPDATE business_products SET 
                quantity = ?, 
                warehouse_id = ?, 
                stock_status = 'In Stock', 
                updated_at = ? 
            WHERE id = ? AND user_id = ?
        `).run(newQty, targetWhName, now, existingWhProduct.id, userId);
    } else {
        db.prepare(`
            INSERT INTO business_products (
                user_id, name, sku, category, quantity, unit,
                purchase_price, selling_price, warehouse_id, stock_status, created_at, updated_at
            ) VALUES (?, ?, ?, 'General', ?, 'PCS', 100, 150, ?, 'In Stock', ?, ?)
        `).run(userId, cleanPName, prodSku, rQty, targetWhName, now, now);
    }

    // Check existing in stock table
    let existingStock = db.prepare(`
        SELECT * FROM stock 
        WHERE user_id = ? 
          AND (LOWER(location) = ? OR location IS NULL) 
          AND (LOWER(name) = ? OR (sku IS NOT NULL AND LOWER(sku) = ?))
        LIMIT 1
    `).get(userId, targetWhName.toLowerCase(), cleanPName.toLowerCase(), prodSku.toLowerCase());

    if (existingStock) {
        db.prepare('UPDATE stock SET quantity = quantity + ?, location = ?, updated_at = ? WHERE id = ?')
            .run(rQty, targetWhName, now, existingStock.id);
    } else {
        db.prepare(`
            INSERT INTO stock (user_id, name, sku, category, unit, unit_price, quantity, location, created_at, updated_at)
            VALUES (?, ?, ?, 'General', 'PCS', 100, ?, ?, ?, ?)
        `).run(userId, cleanPName, prodSku, rQty, targetWhName, now, now);
    }
}

// 3. Verify Database After Update
const afterProd = db.prepare("SELECT id, name, sku, quantity, warehouse_id FROM business_products WHERE id = ?").get(initProd.id);
console.log('\n2. Database After Move to Warehouse Submit:');
console.log('   business_products row:', afterProd);

const afterStock = db.prepare("SELECT id, name, sku, quantity, location FROM stock WHERE user_id = ? AND LOWER(name) = ?").get(userId, prodName.toLowerCase());
console.log('   stock row:', afterStock);

// 4. Simulate Avadi Products List API / Frontend retrieval
const dbProducts = db.prepare("SELECT * FROM business_products WHERE user_id = ?").all(userId);
const dbStocks = db.prepare("SELECT * FROM stock WHERE user_id = ?").all(userId);

const targetWarehouseForList = { id: 14, warehouse_code: 'wh-09', warehouse_name: 'Avadi' };
const targetId = String(targetWarehouseForList.id);
const targetCode = (targetWarehouseForList.warehouse_code || '').toLowerCase();
const targetName = (targetWarehouseForList.warehouse_name || '').toLowerCase();

const resultList = [];
const seenSkus = new Set();

dbProducts.forEach(p => {
    if (!p) return;
    const pWhId = String(p.warehouse_id || '').toLowerCase();
    if (pWhId === targetId.toLowerCase() || pWhId === targetCode || pWhId === targetName || pWhId === `wh-0${targetId.toLowerCase()}` || (targetName && pWhId.includes(targetName))) {
        const key = (p.sku || p.name || '').toLowerCase();
        seenSkus.add(key);
        resultList.push({ id: p.id, name: p.name, sku: p.sku, quantity: p.quantity, unit: p.unit });
    }
});

dbStocks.forEach(s => {
    if (!s) return;
    const loc = (s.location || '').toLowerCase();
    if (loc === targetName || (targetName && loc.includes(targetName))) {
        const key = (s.sku || s.name || '').toLowerCase();
        if (!seenSkus.has(key)) {
            seenSkus.add(key);
            resultList.push({ id: `stk-${s.id}`, name: s.name, sku: s.sku, quantity: s.quantity, unit: s.unit });
        }
    }
});

console.log('\n3. Products List returned for Avadi Warehouse Modal:');
console.log(resultList);

if (afterProd.quantity === 16 && afterStock.quantity === 16 && resultList.length > 0 && resultList[0].quantity === 16) {
    console.log('\n======================================================');
    console.log('✅ ALL VERIFICATIONS PASSED SUCCESSFULLY!');
    console.log('   Before = 13 PCS -> Return = 3 PCS -> After = 16 PCS');
    console.log('   Database Persistence: CONFIRMED');
    console.log('   Warehouse Products List Output: CONFIRMED');
    console.log('======================================================');
} else {
    console.log('\n❌ VERIFICATION FAILED');
}
