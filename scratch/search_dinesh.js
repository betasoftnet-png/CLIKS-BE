const db = require('../db/connection');

async function searchDinesh() {
    const invs = await db.prepare("SELECT * FROM business_invoices WHERE LOWER(client_email) LIKE '%dinesh%' OR LOWER(client_name) LIKE '%dinesh%'").all();
    console.log('Invoices matching dinesh:', invs);

    const users = await db.prepare("SELECT * FROM users WHERE LOWER(email) LIKE '%dinesh%' OR LOWER(username) LIKE '%dinesh%'").all();
    console.log('Users matching dinesh:', users);
}

searchDinesh().catch(err => console.error(err));
