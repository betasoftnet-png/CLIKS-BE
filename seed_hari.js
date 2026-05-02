const db = require('./db/connection');

async function seed() {
    const userId = 5;
    console.log(`Seeding data for user ${userId}...`);
    
    try {
        // CRM
        await db.prepare('INSERT INTO business_customers (user_id, name, email, company, status, total_spent) VALUES (?, ?, ?, ?, ?, ?)')
            .run([userId, 'Acme Corp', 'contact@acme.com', 'Acme Corporation', 'active', 150000]);
        await db.prepare('INSERT INTO business_customers (user_id, name, email, company, status, total_spent) VALUES (?, ?, ?, ?, ?, ?)')
            .run([userId, 'Globex', 'info@globex.com', 'Globex Corp', 'lead', 0]);

        // Staffing
        await db.prepare('INSERT INTO business_employees (user_id, name, role, email, salary, status) VALUES (?, ?, ?, ?, ?, ?)')
            .run([userId, 'Alice Johnson', 'Operations Manager', 'alice@company.com', 85000, 'active']);
        await db.prepare('INSERT INTO business_employees (user_id, name, role, email, salary, status) VALUES (?, ?, ?, ?, ?, ?)')
            .run([userId, 'Bob Smith', 'Senior Developer', 'bob@company.com', 120000, 'active']);

        // Inventory
        await db.prepare('INSERT INTO inventory (user_id, name, sku, category, quantity, price, supplier) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run([userId, 'Pro Laptop M3', 'LAP-001', 'Electronics', 15, 145000, 'Apple B2B']);
        await db.prepare('INSERT INTO inventory (user_id, name, sku, category, quantity, price, supplier) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run([userId, 'Wireless Mouse', 'ACC-042', 'Peripherals', 8, 2500, 'Logitech']);

        // Billing
        await db.prepare('INSERT INTO business_invoices (user_id, invoice_number, client_name, client_email, amount, status, due_date) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run([userId, 'INV-2026-001', 'Acme Corp', 'billing@acme.com', 45000, 'Paid', '2026-04-15']);
        await db.prepare('INSERT INTO business_invoices (user_id, invoice_number, client_name, client_email, amount, status, due_date) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run([userId, 'INV-2026-002', 'Globex', 'billing@globex.com', 12500, 'Unpaid', '2026-05-10']);

        console.log('✅ Seeding complete for user 5!');
    } catch (err) {
        console.error('❌ Error seeding:', err);
    } finally {
        process.exit();
    }
}

seed();
