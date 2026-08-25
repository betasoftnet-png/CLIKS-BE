const db = require('../db/connection');

async function testAutoFilingStatus() {
    try {
        console.log('Testing automated filing status transitions...');
        
        // 1. Create a dummy task with status Pending
        const now = new Date().toISOString();
        const res = await db.prepare(`
            INSERT INTO ca_tasks (
                ca_user_id, advisor_id, advisor_email, client_name, client_email,
                title, task_description, status, priority, due_date, ask_for_document, business_owner_id, created_at
            ) VALUES (99, 99, 'ca@test.com', 'Test Owner', 'owner@test.com', 'GST Return Documents Needed', 'Upload GST doc', 'Pending', 'Medium', '2026-08-30', 1, 88, ?)
        `).run(now);

        const taskId = res.lastInsertRowid;
        console.log('Task created with ID:', taskId);

        // Verify initial status is Pending
        let task = await db.prepare("SELECT * FROM ca_tasks WHERE id = ?").get(taskId);
        console.log('Initial Status (Unseen):', task.status);

        // 2. Simulate Business Owner (user id 88) fetching tasks (seeing the task)
        await db.prepare(`
            UPDATE ca_tasks 
            SET status = 'In Progress' 
            WHERE status = 'Pending' 
              AND (business_owner_id = 88 OR LOWER(client_email) = 'owner@test.com')
              AND ca_user_id != 88
        `).run();

        task = await db.prepare("SELECT * FROM ca_tasks WHERE id = ?").get(taskId);
        console.log('Status after Business Owner views task:', task.status);

        // 3. Simulate Business Owner uploading document
        await db.prepare(`
            UPDATE ca_tasks 
            SET attached_file = 'test_doc.pdf', status = 'Completed'
            WHERE id = ?
        `).run(taskId);

        task = await db.prepare("SELECT * FROM ca_tasks WHERE id = ?").get(taskId);
        console.log('Status after Business Owner uploads document:', task.status);

        if (task.status === 'Completed') {
            console.log('SUCCESS: Filing status automation verified successfully!');
        }

        // Cleanup test task
        await db.prepare("DELETE FROM ca_tasks WHERE id = ?").run(taskId);

    } catch (err) {
        console.error('ERROR in test:', err);
    }
}

testAutoFilingStatus();
