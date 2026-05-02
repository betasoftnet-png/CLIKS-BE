const db = require('./db/connection');

async function testBilling() {
    try {
        console.log('--- Testing Billing Table ---');
        
        // 1. Check if table exists
        const tableCheck = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='business_invoices'").get();
        if (tableCheck) {
            console.log('✅ business_invoices table exists.');
        } else {
            console.error('❌ business_invoices table NOT found.');
            process.exit(1);
        }

        // 2. Insert test invoice
        const now = new Date().toISOString();
        const insertSql = `INSERT INTO business_invoices (user_id, invoice_number, client_name, client_email, amount, status, due_date, items, created_at, updated_at) 
                          VALUES (1, 'INV-TEST-001', 'Test Client', 'test@client.com', 5000, 'Unpaid', '2024-12-31', '[]', '${now}', '${now}')`;
        
        await db.prepare(insertSql).run();
        console.log('✅ Test invoice inserted successfully.');

        // 3. Verify retrieval
        const rows = await db.prepare('SELECT * FROM business_invoices WHERE invoice_number = ?').all('INV-TEST-001');
            
        if (rows.length > 0) {
            console.log('✅ Data verification successful:', rows[0].invoice_number, 'Client:', rows[0].client_name);
        } else {
            console.error('❌ Data verification failed.');
        }

        // 4. Cleanup
        await db.prepare("DELETE FROM business_invoices WHERE invoice_number = 'INV-TEST-001'").run();
        console.log('✅ Cleanup successful.');

        console.log('--- All Billing Tests Passed ---');
        process.exit(0);
    } catch (e) {
        console.error('❌ Test failed:', e);
        process.exit(1);
    }
}

testBilling();
