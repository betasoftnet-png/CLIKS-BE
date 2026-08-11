const db = require('../db/connection');

async function debugAll88() {
  const user88 = await db.prepare("SELECT * FROM users WHERE id = 88").get();
  console.log('User 88:', user88);

  const conn88 = await db.prepare("SELECT * FROM customer_connections WHERE id = 88 OR website_user_id = 88").all();
  console.log('Connections 88:', conn88);

  const hist88 = await db.prepare("SELECT * FROM customer_purchase_history WHERE id = 88 OR customer_user_id = 88 OR invoice_id = 88").all();
  console.log('Purchase History 88:', hist88);
}

debugAll88().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
