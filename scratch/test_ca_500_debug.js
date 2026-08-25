const db = require('../db/connection');

async function testColumns() {
    try {
        const tableInfo = await db.prepare("PRAGMA table_info(ca_audit_sessions)").all();
        console.log('ca_audit_sessions columns:', tableInfo.map(c => c.name));

        const viewInfo = await db.prepare("PRAGMA table_info(audit_sessions)").all();
        console.log('audit_sessions view columns:', viewInfo.map(c => c.name));
    } catch(e) {
        console.error('Error PRAGMA:', e);
    }
}

testColumns();
