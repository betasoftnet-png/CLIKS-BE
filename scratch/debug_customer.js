const db = require('../db/connection');

async function debugCust() {
  const cust88 = await db.prepare("SELECT * FROM business_customers WHERE id = 88").get();
  console.log('Customer 88:', cust88);

  const allCusts = await db.prepare("SELECT id, user_id, name, email, phone FROM business_customers ORDER BY id DESC LIMIT 10").all();
  console.log('Recent 10 Customers:', allCusts);
}

debugCust().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
