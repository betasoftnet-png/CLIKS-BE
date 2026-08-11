const db = require('../db/connection');
const gstHelper = require('../utils/gstHelper');

async function checkSync() {
  console.log('=== BUSINESS INVOICES IN DB ===');
  const sales = await db.prepare("SELECT id, user_id, invoice_number, client_name, client_gstin, amount, tax_amount, total_amount, invoice_type FROM business_invoices").all();
  console.table(sales);

  console.log('\n=== GST INVOICES IN DB ===');
  const gstr1 = await db.prepare("SELECT id, user_id, invoice_number, client_name, customer_gstin, taxable_value, total_tax, total_invoice, invoice_type, status FROM gst_invoices WHERE is_eway_bill NOT IN ('true', '1', 1) AND is_reconciliation NOT IN ('true', '1', 1)").all();
  console.table(gstr1);
}

checkSync().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
