const db = require('../db/connection');

async function testCustomerAPI() {
    try {
        console.log("=== Running ALTER TABLE migrations for business_customers ===");
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
                console.log(`Executed: ${alterSql}`);
            } catch (e) {
                // Column might already exist
            }
        }

        console.log("\n=== PRAGMA table_info(business_customers) ===");
        const columns = await db.prepare("PRAGMA table_info(business_customers)").all();
        console.log(columns.map(c => `${c.cid}: ${c.name} (${c.type})`).join("\n"));

        console.log("\n=== Testing Real Frontend Payload ===");
        const frontendBody = { 
            customer_code: `CUST-${Date.now().toString().slice(-4)}`,
            name: 'Jane Customer', 
            business_name: 'Acme Pvt Ltd', 
            contact_person: 'Jane Doe',
            email: 'jane@acme.local', 
            phone_number: '9876543210', 
            alternate_phone: '9123456789',
            website: 'https://acme.local',
            customer_type: 'wholesale',
            gstin: '07AAAAA0000A1Z5',
            pan_number: 'AAAAA0000A',
            tax_type: 'registered',
            place_of_supply: 'Delhi',
            status: 'active', 
            credit_limit: 50000,
            opening_balance: 1000,
            current_balance: 1000,
            loyalty_points: 50,
            due_days: 30,
            billing_address: '123 Business Street',
            shipping_address: '123 Business Street',
            city: 'New Delhi',
            state: 'Delhi',
            pincode: '110001',
            notes: 'Priority customer',
            reminder_enabled: true,
            preferred_contact: 'WhatsApp'
        };

        const user = await db.prepare("SELECT * FROM users LIMIT 1").get();
        const testUserId = user ? user.id : 1;

        console.log("Request Body:", JSON.stringify(frontendBody, null, 2));

        const name = frontendBody.name || frontendBody.customer_name || frontendBody.contact_person;
        const company = frontendBody.company || frontendBody.business_name || null;
        const gstin = frontendBody.gstin || null;
        const pan = frontendBody.pan || frontendBody.pan_number || null;
        const email = frontendBody.email || null;
        const phone = frontendBody.phone || frontendBody.phone_number || null;
        const address = frontendBody.address || frontendBody.billing_address || null;
        const shipping_address = frontendBody.shipping_address || null;
        const city = frontendBody.city || null;
        const state = frontendBody.state || null;
        const country = frontendBody.country || 'India';
        const pincode = frontendBody.pincode || null;
        const opening_balance = parseFloat(frontendBody.opening_balance || frontendBody.openingBalance) || 0;
        const credit_limit = parseFloat(frontendBody.credit_limit || frontendBody.creditLimit) || 0;
        const status = frontendBody.status || 'Active';
        const customer_code = frontendBody.customer_code || null;
        const contact_person = frontendBody.contact_person || null;
        const alternate_phone = frontendBody.alternate_phone || null;
        const website = frontendBody.website || null;
        const customer_type = frontendBody.customer_type || null;
        const tax_type = frontendBody.tax_type || null;
        const place_of_supply = frontendBody.place_of_supply || null;
        const due_days = parseInt(frontendBody.due_days) || 30;
        const notes = frontendBody.notes || null;
        const preferred_contact = frontendBody.preferred_contact || 'WhatsApp';
        const reminder_enabled = frontendBody.reminder_enabled ? 1 : 0;
        const loyalty_points = parseInt(frontendBody.loyalty_points) || 0;
        const now = new Date().toISOString();

        const sql = `
            INSERT INTO business_customers (
                user_id, name, company, business_name, contact_person, gstin, pan, email, phone, 
                alternate_phone, website, customer_type, tax_type, place_of_supply, address, 
                shipping_address, city, state, country, pincode, opening_balance, credit_limit, 
                status, customer_code, due_days, notes, preferred_contact, reminder_enabled, 
                loyalty_points, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const params = [
            testUserId, name, company, company, contact_person, gstin, pan, email, phone,
            alternate_phone, website, customer_type, tax_type, place_of_supply, address,
            shipping_address, city, state, country, pincode, opening_balance, credit_limit,
            status, customer_code, due_days, notes, preferred_contact, reminder_enabled,
            loyalty_points, now, now
        ];

        console.log("\nSQL Query:\n", sql);
        console.log("\nSQL Parameters:\n", params);

        const result = await db.prepare(sql).run(...params);
        console.log("\nSUCCESS RESULT:", result);

        const newCustomer = await db.prepare('SELECT * FROM business_customers WHERE id = ?').get(result.lastInsertRowid);
        console.log("\nINSERTED ROW:\n", newCustomer);

    } catch (err) {
        console.error("DATABASE ERROR:", err);
    }
}

testCustomerAPI();
