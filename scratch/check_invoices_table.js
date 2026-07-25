const Database = require('better-sqlite3');
const db = new Database('./db/books_finance.db');

try {
  const schemaInvoices = db.prepare("PRAGMA table_info(business_invoices)").all();
  console.log("business_invoices Schema:");
  console.log(schemaInvoices.map(c => `${c.name} (${c.type})`).join(', '));

  const schemaPayments = db.prepare("PRAGMA table_info(business_invoice_payments)").all();
  console.log("\nbusiness_invoice_payments Schema:");
  console.log(schemaPayments.map(c => `${c.name} (${c.type})`).join(', '));

  const invoices = db.prepare("SELECT * FROM business_invoices LIMIT 5").all();
  console.log("\nSample business_invoices:", invoices);

  const payments = db.prepare("SELECT * FROM business_invoice_payments LIMIT 5").all();
  console.log("\nSample business_invoice_payments:", payments);

  const bankAccounts = db.prepare("SELECT * FROM accounting WHERE entry_type = 'AccountConfig'").all();
  console.log("\nBank Accounts:", bankAccounts);

} catch (e) {
  console.error("Error:", e.message);
}
