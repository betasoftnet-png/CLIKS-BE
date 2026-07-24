const db = require('../db/connection');

async function check() {
  try {
    const invs = await db.prepare("SELECT * FROM business_invoices LIMIT 2").all();
    console.log("Invoices in DB:", invs.length);
    const custs = await db.prepare("SELECT * FROM business_customers LIMIT 2").all();
    console.log("Customers in DB:", custs.length);
    const prods = await db.prepare("SELECT * FROM business_products LIMIT 2").all();
    console.log("Products in DB:", prods.length);
  } catch (err) {
    console.error("Query test failed:", err.message);
  }
}
check();
