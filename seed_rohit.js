const db = require('./db/connection');

async function seed() {
    const userId = 7; // rohit@gmail.com
    const now = new Date().toISOString();

    console.log('Seeding data for user 7...');

    try {
        // 1. CRM Customers
        await db.prepare(`INSERT INTO business_customers (user_id, name, email, phone, company, status, total_spent, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run([
            userId, 'John Doe', 'john@example.com', '1234567890', 'Example Corp', 'active', 5000, now, now
        ]);
        await db.prepare(`INSERT INTO business_customers (user_id, name, email, phone, company, status, total_spent, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run([
            userId, 'Jane Smith', 'jane@test.com', '0987654321', 'Test Inc', 'lead', 0, now, now
        ]);

        // 2. Inventory Items
        await db.prepare(`INSERT INTO inventory (user_id, name, sku, category, quantity, price, supplier, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run([
            userId, 'Product A', 'SKU-A', 'Electronics', 50, 1000, 'Supplier 1', 'In Stock', now, now
        ]);
        await db.prepare(`INSERT INTO inventory (user_id, name, sku, category, quantity, price, supplier, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run([
            userId, 'Product B', 'SKU-B', 'Furniture', 5, 5000, 'Supplier 2', 'Low Stock', now, now
        ]);

        // 3. Invoices
        await db.prepare(`INSERT INTO business_invoices (user_id, invoice_number, client_name, client_email, amount, status, due_date, items, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run([
            userId, 'INV-001', 'John Doe', 'john@example.com', 2500, 'Paid', '2026-05-15', '[]', now, now
        ]);
        await db.prepare(`INSERT INTO business_invoices (user_id, invoice_number, client_name, client_email, amount, status, due_date, items, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run([
            userId, 'INV-002', 'Jane Smith', 'jane@test.com', 1500, 'Unpaid', '2026-05-20', '[]', now, now
        ]);

        console.log('Seeding completed successfully!');
    } catch (err) {
        console.error('Seeding failed:', err);
    } finally {
        process.exit();
    }
}

seed();
