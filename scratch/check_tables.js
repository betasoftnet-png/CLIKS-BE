const db = require('../db/connection');

async function check() {
  try {
    const invoices = await db.prepare('PRAGMA table_info(business_invoices)').all();
    console.log('--- business_invoices schema ---');
    console.log(invoices.map(c => `${c.name} (${c.type})`).join(', '));
  } catch (e) {
    console.error('business_invoices check failed:', e.message);
  }

  try {
    const payments = await db.prepare('PRAGMA table_info(business_invoice_payments)').all();
    console.log('--- business_invoice_payments schema ---');
    console.log(payments.map(c => `${c.name} (${c.type})`).join(', '));
  } catch (e) {
    console.error('business_invoice_payments check failed:', e.message);
  }

  try {
    const purchases = await db.prepare('PRAGMA table_info(business_purchases)').all();
    console.log('--- business_purchases schema ---');
    console.log(purchases.map(c => `${c.name} (${c.type})`).join(', '));
  } catch (e) {
    console.error('business_purchases check failed:', e.message);
  }
}

check();
