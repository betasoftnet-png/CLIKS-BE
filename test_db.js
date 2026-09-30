const db = require('./db/connection');
async function test() {
  try {
    const now = new Date().toISOString();
    const result = await db.prepare(`
                INSERT INTO expenses (
                    user_id, amount, employee_name, employee_code, department, travel_expense, claim_amount, reimbursement_status, is_claim, receipt, date, time, 
                    proof_file_path, proof_file_name, proof_file_type, proof_timestamp, proof_files, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending Approval', 'true', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                1, 100, 'John Doe', 'CLK-001', 'IT', 'Travel', 100, 'receipt.jpg', '2023-10-01', '12:00', '/uploads/123.jpg', '123.jpg', 'JPG', now, '[]', now, now
            );
    console.log("Result:", result);
    console.log("lastInsertRowid:", result.lastInsertRowid);
    const inserted = await db.prepare('SELECT * FROM expenses WHERE id = ?').get(result.lastInsertRowid);
    console.log("inserted:", inserted);
  } catch (err) {
    console.error("DB Error:", err);
  }
}
test();
