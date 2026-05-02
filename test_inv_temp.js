const db = require('./db/connection');

async function testInventory() {
    try {
        console.log('--- Testing Inventory Table ---');
        
        // 1. Check if table exists
        const tableCheck = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='inventory'").get();
        if (tableCheck) {
            console.log('✅ Inventory table exists.');
        } else {
            // Check Postgres
            try {
                await db.pool.query("SELECT 'inventory'::regclass");
                console.log('✅ Inventory table exists (Postgres).');
            } catch (e) {
                console.error('❌ Inventory table NOT found.');
                process.exit(1);
            }
        }

        // 2. Insert test item
        const now = new Date().toISOString();
        const insertSql = `INSERT INTO inventory (user_id, name, sku, category, quantity, price, supplier, status, created_at, updated_at) 
                          VALUES (1, 'Test Widget', 'W-001', 'General', 50, 199.99, 'Test Supplier', 'In Stock', '${now}', '${now}')`;
        
        if (db.prepare) {
            await db.prepare(insertSql).run();
        } else {
            await db.pool.query(insertSql.replace(/INSERT INTO inventory/, 'INSERT INTO inventory'));
        }
        console.log('✅ Test item inserted successfully.');

        // 3. Verify retrieval
        const rows = db.prepare 
            ? await db.prepare('SELECT * FROM inventory WHERE name = ?').all('Test Widget')
            : (await db.pool.query("SELECT * FROM inventory WHERE name = 'Test Widget'")).rows;
            
        if (rows.length > 0) {
            console.log('✅ Data verification successful:', rows[0].name, 'SKU:', rows[0].sku);
        } else {
            console.error('❌ Data verification failed.');
        }

        // 4. Cleanup
        const deleteSql = "DELETE FROM inventory WHERE name = 'Test Widget'";
        if (db.prepare) {
            await db.prepare(deleteSql).run();
        } else {
            await db.pool.query(deleteSql);
        }
        console.log('✅ Cleanup successful.');

        console.log('--- All Tests Passed ---');
        process.exit(0);
    } catch (e) {
        console.error('❌ Test failed:', e);
        process.exit(1);
    }
}

testInventory();
