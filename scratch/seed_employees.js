const Database = require('better-sqlite3');
const db = new Database('./db/books_finance.db');

const sampleEmployees = [
  { id: 1, name: 'Karan Mehra', department: 'Inventory', status: 'active', email: 'karan.mehra@cliks.com' },
  { id: 29, name: 'Arun Kumar', department: 'Sales', status: 'active', email: 'arun.k@cliks.com' },
  { id: 30, name: 'Ashwin Kumar', department: 'Inventory', status: 'active', email: 'ashwin.k@cliks.com' },
  { id: 32, name: 'Aravind', department: 'Accounts', status: 'active', email: 'aravind@cliks.com' },
  { id: 35, name: 'Santhosh', department: 'Accounts', status: 'active', email: 'santhosh@cliks.com' },
  { id: 41, name: 'Arun Prakash', department: 'Operations', status: 'active', email: 'arun.p@cliks.com' }
];

try {
  const check = db.prepare("SELECT COUNT(*) as count FROM employees").get();
  if (check.count === 0) {
    console.log("Seeding sample employees...");
    const now = new Date().toISOString();
    const insert = db.prepare(`
      INSERT INTO employees (id, user_id, name, department, status, role, email, phone, salary, hire_date, created_at, updated_at)
      VALUES (?, 1, ?, ?, ?, 'Staff', ?, '+91 99999 88888', 35000, ?, ?, ?)
    `);
    
    for (const emp of sampleEmployees) {
      insert.run(emp.id, emp.name, emp.department, emp.status, emp.email, now.split('T')[0], now, now);
    }
    console.log("✅ Seeded sample employees successfully!");
  } else {
    console.log("Employees table already has records, skipping seed.");
  }
} catch (e) {
  console.error("Seeding Error:", e.message);
}
