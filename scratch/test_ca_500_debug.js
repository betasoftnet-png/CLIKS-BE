const db = require('../db/connection');

try {
    console.log('Testing binding undefined...');
    const res = db.prepare("SELECT business_owner_id, name FROM ca_clients WHERE id = ?").get(undefined);
    console.log('Result:', res);
} catch (err) {
    console.error('BINDING UNDEFINED THREW ERROR:', err);
}
