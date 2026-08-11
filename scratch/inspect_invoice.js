const db = require('../db/connection');

async function inspectAllInv() {
  const invs = await db.prepare("SELECT id, user_id, invoice_number, client_name, client_gstin, amount, tax_amount, total_amount, invoice_type FROM business_invoices ORDER BY id DESC LIMIT 15").all();
  console.log('Recent 15 Invoices in business_invoices:', invs);
}

inspectAllInv().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
