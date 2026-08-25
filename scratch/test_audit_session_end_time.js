const db = require('../db/connection');

async function testAuditSessionSchema() {
    try {
        console.log('Testing ca_audit_sessions schema and end_time field...');
        const tableInfo = await db.prepare("PRAGMA table_info(ca_audit_sessions)").all();
        const hasEndTime = tableInfo.some(c => c.name === 'end_time');
        console.log('Has end_time column:', hasEndTime);

        if (!hasEndTime) {
            console.log('Adding end_time column...');
            await db.prepare("ALTER TABLE ca_audit_sessions ADD COLUMN end_time TEXT").run();
        }

        const now = new Date().toISOString();
        const testSessionId = `AUD-TEST-${Date.now()}`;
        const startTime = '10:00:00 AM';
        const endTime = '10:30:00 AM';

        console.log('Inserting test session with end_time...');
        const res = await db.prepare(`
            INSERT INTO ca_audit_sessions (
                session_id, ca_user_id, client_id, business_owner_id, start_time, stop_time, end_time,
                duration_seconds, audit_date, audit_description, hourly_rate, professional_fee,
                gst_amount, grand_total, invoice_number, payment_status, status, created_at
            ) VALUES (?, 1, 1, 1, ?, ?, ?, 1800, ?, 'Test Audit Procedure', 500, 250, 45, 295, 'INV-TEST-1', 'Pending Payment', 'Completed', ?)
        `).run(testSessionId, startTime, now, endTime, now.split('T')[0], now);

        console.log('Inserted session ID:', res.lastInsertRowid);

        const fetched = await db.prepare("SELECT * FROM ca_audit_sessions WHERE id = ?").get(res.lastInsertRowid);
        console.log('Fetched session end_time:', fetched.end_time);

        if (fetched.end_time === endTime) {
            console.log('SUCCESS: end_time persisted and verified correctly!');
        } else {
            console.error('FAILED: end_time mismatch');
        }

    } catch (err) {
        console.error('ERROR in test:', err);
    }
}

testAuditSessionSchema();
