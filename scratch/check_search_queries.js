const db = require('../db/connection');

async function check() {
  const userId = 1;
  const searchTerm = '%sa%';

  // 1. Invoices
  try {
      const invoices = await db.prepare(`
          SELECT id, invoice_number, client_name, total_amount, status 
          FROM business_invoices 
          WHERE user_id = ? AND (invoice_number LIKE ? OR client_name LIKE ?)
          LIMIT 5
      `).all(userId, searchTerm, searchTerm);
      console.log("Invoices query OK, results:", invoices.length);
  } catch (e) {
      console.error('Invoices query FAILED:', e.message);
  }

  // 2. Customers
  try {
      const customers = await db.prepare(`
          SELECT id, name, company, email 
          FROM business_customers 
          WHERE user_id = ? AND (name LIKE ? OR company LIKE ? OR email LIKE ?)
          LIMIT 5
      `).all(userId, searchTerm, searchTerm, searchTerm);
      console.log("Customers query OK, results:", customers.length);
  } catch (e) {
      console.error('Customers query FAILED:', e.message);
  }

  // 3. Products
  try {
      const products = await db.prepare(`
          SELECT id, name, sku, category, selling_price 
          FROM business_products 
          WHERE user_id = ? AND (name LIKE ? OR sku LIKE ? OR category LIKE ?)
          LIMIT 5
      `).all(userId, searchTerm, searchTerm, searchTerm);
      console.log("Products query OK, results:", products.length);
  } catch (e) {
      console.error('Products query FAILED:', e.message);
  }

  // 4. Accounting Entries
  try {
      const accounting = await db.prepare(`
          SELECT id, entry_type, amount, category, mode, notes 
          FROM accounting 
          WHERE user_id = ? AND (category LIKE ? OR mode LIKE ? OR notes LIKE ?)
          LIMIT 5
      `).all(userId, searchTerm, searchTerm, searchTerm);
      console.log("Accounting query OK, results:", accounting.length);
  } catch (e) {
      console.error('Accounting query FAILED:', e.message);
  }

  // 5. Expense Entries
  try {
      const expenses = await db.prepare(`
          SELECT id, category, amount, description 
          FROM expenses 
          WHERE user_id = ? AND (category LIKE ? OR description LIKE ?)
          LIMIT 5
      `).all(userId, searchTerm, searchTerm);
      console.log("Expenses query OK, results:", expenses.length);
  } catch (e) {
      console.error('Expenses query FAILED:', e.message);
  }
}
check();
