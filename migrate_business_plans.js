const db = require('./db/connection');

async function run() {
    console.log('Creating Business Financial Plan tables...');
    try {
        const queries = [
            `CREATE TABLE IF NOT EXISTS business_plans (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                start_date TEXT,
                end_date TEXT,
                total_budget NUMERIC DEFAULT 0,
                status VARCHAR(50) DEFAULT 'Draft',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )`,
            `CREATE TABLE IF NOT EXISTS business_plan_items (
                id SERIAL PRIMARY KEY,
                plan_id INTEGER NOT NULL,
                type VARCHAR(50), -- revenue, expense, capex
                category VARCHAR(100),
                description TEXT,
                amount NUMERIC DEFAULT 0,
                date TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(plan_id) REFERENCES business_plans(id) ON DELETE CASCADE
            )`
        ];

        for (const q of queries) {
            await db.pool.query(q);
        }
        console.log('✅ Business Financial Plan tables created successfully!');
    } catch (err) {
        console.error('❌ Error creating tables:', err);
    } finally {
        process.exit();
    }
}

run();
