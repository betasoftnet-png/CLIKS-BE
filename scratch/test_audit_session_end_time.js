const db = require('../db/connection');

async function testProInvoiceSchema() {
    try {
        console.log('Ensuring audit_description column on ca_professional_invoices...');
        try { await db.prepare("ALTER TABLE ca_professional_invoices ADD COLUMN audit_description TEXT").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE ca_professional_invoices ADD COLUMN start_time TEXT").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE ca_professional_invoices ADD COLUMN end_time TEXT").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE ca_professional_invoices ADD COLUMN hourly_rate REAL DEFAULT 500").run(); } catch(e) {}
        try { await db.prepare("ALTER TABLE ca_professional_invoices ADD COLUMN duration_text TEXT").run(); } catch(e) {}

        const tableInfo = await db.prepare("PRAGMA table_info(ca_professional_invoices)").all();
        console.log('ca_professional_invoices columns:', tableInfo.map(c => c.name));

        const hasAuditDesc = tableInfo.some(c => c.name === 'audit_description');
        console.log('Has audit_description column:', hasAuditDesc);

        if (hasAuditDesc) {
            console.log('Testing dummy insert into ca_professional_invoices...');
            const invNum = `INV-PRO-TEST-${Date.now().toString().slice(-4)}`;
            const res = await db.prepare(`
                INSERT INTO ca_professional_invoices (
                    invoice_number, ca_user_id, business_owner_id, client_id, audit_session_id,
                    audit_description, start_time, end_time, hourly_rate, duration_text,
                    amount, gst_amount, total_amount, status, invoice_date, pdf_path, created_at
                ) VALUES (?, 1, 1, 1, 1, 'GSTR-1 Filing & Audit Review', '10:00 AM', '10:30 AM', 500, '30 Minutes', 250, 45, 295, 'Unpaid', '2026-08-25', '/invoices/test.pdf', '2026-08-25T13:55:00.000Z')
            `).run(invNum);

            console.log('Insert success! Row ID:', res.lastInsertRowid);
        }

    } catch (err) {
        console.error('ERROR in test:', err);
    }
}

testProInvoiceSchema();
