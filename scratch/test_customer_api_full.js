const customerController = require('../controllers/customerController');
const db = require('../db/connection');

async function runTest() {
    try {
        console.log("=== Running DB Migrations for customers table ===");
        const newCols = [
            'ALTER TABLE business_customers ADD COLUMN customer_code TEXT',
            'ALTER TABLE business_customers ADD COLUMN business_name TEXT',
            'ALTER TABLE business_customers ADD COLUMN contact_person TEXT',
            'ALTER TABLE business_customers ADD COLUMN alternate_phone TEXT',
            'ALTER TABLE business_customers ADD COLUMN website TEXT',
            'ALTER TABLE business_customers ADD COLUMN customer_type TEXT',
            'ALTER TABLE business_customers ADD COLUMN tax_type TEXT',
            'ALTER TABLE business_customers ADD COLUMN place_of_supply TEXT',
            'ALTER TABLE business_customers ADD COLUMN shipping_address TEXT',
            'ALTER TABLE business_customers ADD COLUMN pincode TEXT',
            'ALTER TABLE business_customers ADD COLUMN due_days INTEGER DEFAULT 30',
            'ALTER TABLE business_customers ADD COLUMN preferred_contact TEXT',
            'ALTER TABLE business_customers ADD COLUMN reminder_enabled INTEGER DEFAULT 1'
        ];

        for (const alterSql of newCols) {
            try {
                await db.prepare(alterSql).run();
            } catch (e) {}
        }

        const user = await db.prepare("SELECT * FROM users LIMIT 1").get();
        const testUserId = user ? user.id : 1;

        const req = {
            user: { id: testUserId, username: 'TestAdmin', role: 'admin' },
            body: {
                customer_code: `CUST-TEST-${Date.now()}`,
                name: 'Registration Test Customer',
                business_name: 'Test Business Corp',
                contact_person: 'Alice Smith',
                email: 'alice@testbusiness.local',
                phone_number: '9988776655',
                alternate_phone: '9988776644',
                website: 'https://testbusiness.local',
                customer_type: 'retail',
                gstin: '07BBBBB0000B1Z5',
                pan_number: 'BBBBB0000B',
                tax_type: 'registered',
                place_of_supply: 'Delhi',
                status: 'active',
                credit_limit: 100000,
                opening_balance: 500,
                current_balance: 500,
                loyalty_points: 100,
                due_days: 15,
                billing_address: '456 Commercial Rd',
                shipping_address: '456 Commercial Rd',
                city: 'Delhi',
                state: 'Delhi',
                pincode: '110002',
                notes: 'Created via automated unit test',
                reminder_enabled: true,
                preferred_contact: 'Email'
            }
        };

        const res = {
            statusCode: 200,
            status: function(code) {
                this.statusCode = code;
                return this;
            },
            json: function(data) {
                console.log(`\nResponse Status: ${this.statusCode}`);
                console.log("Response Body:", JSON.stringify(data, null, 2));
                return data;
            }
        };

        console.log("\n--- Testing customerController.createCustomer ---");
        await customerController.createCustomer(req, res);

    } catch (err) {
        console.error("TEST EXECUTION ERROR:", err);
    }
}

runTest();
