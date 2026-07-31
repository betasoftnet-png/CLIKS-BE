const Database = require('better-sqlite3');
const db = new Database('./db/books_finance.db');

try {
  const rows = db.prepare("SELECT id, user_id, invoice_number, is_eway_bill, is_reconciliation, client_name FROM gst_invoices").all();
  console.log("All Rows in gst_invoices:\n", rows);
} catch (e) {
  console.error("Error:", e.message);
}
